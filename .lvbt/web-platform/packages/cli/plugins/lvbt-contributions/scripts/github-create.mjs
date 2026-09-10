#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { commitSubjectError } from './validate-commit-subject.mjs';

const placeholderPattern =
  /\[(?:describe|optional|subheading|more subheadings|future issue title)[^\]]*\]/i;

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArguments(argv) {
  const [kind, ...rest] = argv;
  const options = { kind, dryRun: false, json: false, draft: false };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--draft') options.draft = true;
    else if (argument?.startsWith('--')) {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) fail(`Missing value for ${argument}.`, 2);
      options[argument.slice(2).replaceAll('-', '_')] = value;
      index += 1;
    } else fail(`Unexpected argument: ${argument}`, 2);
  }
  return options;
}

function headings(body) {
  const matches = [...body.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)];
  return matches.map((match, index) => ({
    title: match[1],
    level: match[0].indexOf(' '),
    start: match.index + match[0].length,
    end:
      matches
        .slice(index + 1)
        .find((candidate) => candidate[0].indexOf(' ') <= match[0].indexOf(' '))?.index ??
      body.length,
  }));
}

function validateSections(body, required, optional = []) {
  const found = headings(body);
  const allowed = [...required, ...optional];
  for (const title of allowed) {
    const matches = found.filter((heading) => heading.title === title);
    if (matches.length > 1) fail(`Section "${title}" must appear exactly once.`);
  }

  let previous = -1;
  for (const title of required) {
    const heading = found.find((candidate) => candidate.title === title);
    if (!heading) fail(`Missing required section "${title}".`);
    const position = found.indexOf(heading);
    if (position <= previous) fail('Required sections are out of order.');
    previous = position;
    const content = body.slice(heading.start, heading.end).trim();
    if (!content) fail(`Section "${title}" cannot be empty.`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  if (result.error) fail(result.error.message, 2);
  if (result.status !== 0) fail(result.stderr.trim() || `${command} failed.`, 2);
  return result.stdout.trim();
}

function normalize(value) {
  return value.replaceAll('\r\n', '\n').trimEnd();
}

function verifyStored(expected, stored) {
  if (stored.title !== expected.title || normalize(stored.body) !== normalize(expected.body)) {
    fail(`GitHub stored metadata that differs from the verified preview for ${stored.url}.`, 2);
  }
}

const options = parseArguments(process.argv.slice(2));
if (!['issue', 'pr'].includes(options.kind)) {
  fail('Usage: github-create issue|pr [options]', 2);
}
if (!options.title?.trim()) fail('A non-empty title is required.');
if (options.title !== options.title.trim()) fail('The title must be trimmed.');
if (placeholderPattern.test(options.title)) fail('The title contains a placeholder.');
if (!options.body_file) fail('--body-file is required.', 2);

const body = await readFile(options.body_file, 'utf8').catch((error) =>
  fail(`Could not read body file: ${error.message}`, 2),
);
if (placeholderPattern.test(body)) fail('The body contains an untouched placeholder.');
if (/<!--|transitmapper:/i.test(body)) fail('Hidden metadata is not allowed.');

let label;
if (options.kind === 'issue') {
  if (options.type === 'bug') {
    validateSections(
      body,
      ['Steps to reproduce', 'Expected behavior', 'Actual behavior'],
      ['Additional context'],
    );
    label = 'bug';
  } else if (options.type === 'feature') {
    validateSections(body, ['Problem', 'Proposed change'], ['Additional context']);
    label = 'enhancement';
  } else fail('--type must be bug or feature.', 2);
} else {
  const subjectError = commitSubjectError(options.title);
  if (subjectError) {
    fail(subjectError);
  }
  validateSections(body, ['TL;DR', 'Overview of Changes'], ['Follow-ups']);
  if (!headings(body).some(({ title }) => title === 'Follow-ups')) {
    fail('Missing required section "Follow-ups".');
  }
}

const preview = {
  valid: true,
  kind: options.kind,
  title: options.title,
  body,
  ...(label ? { label } : {}),
};
if (options.dryRun) {
  process.stdout.write(
    options.json ? `${JSON.stringify(preview)}\n` : `${options.title}\n\n${body}`,
  );
  process.exit(0);
}

let url;
if (options.kind === 'issue') {
  url = run('gh', [
    'issue',
    'create',
    '--title',
    options.title,
    '--body-file',
    options.body_file,
    '--label',
    label,
  ]);
  const stored = JSON.parse(run('gh', ['issue', 'view', url, '--json', 'number,title,body,url']));
  verifyStored(preview, stored);
  preview.number = stored.number;
  preview.url = stored.url;
} else {
  const branch = run('git', ['branch', '--show-current']);
  const base = options.base ?? 'main';
  if (!branch || branch === base) fail(`Create pull requests from a branch other than ${base}.`);
  run('git', ['rev-parse', '--verify', '@{upstream}']);
  if (run('git', ['rev-list', '--count', '@{upstream}..HEAD']) !== '0') {
    fail('Push the current branch before creating its pull request.');
  }
  const args = [
    'pr',
    'create',
    '--title',
    options.title,
    '--body-file',
    options.body_file,
    '--base',
    base,
  ];
  if (options.draft) args.push('--draft');
  url = run('gh', args);
  const stored = JSON.parse(run('gh', ['pr', 'view', url, '--json', 'number,title,body,url']));
  verifyStored(preview, stored);
  preview.number = stored.number;
  preview.url = stored.url;
}

process.stdout.write(options.json ? `${JSON.stringify(preview)}\n` : `${preview.url}\n`);
