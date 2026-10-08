#!/usr/bin/env node

import { hasLabels } from '../../../src/lib/contributions/issue-apply.mjs';

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { commitSubjectError } from './validate-commit-subject.mjs';
import { ownershipLabel } from '../../../src/lib/contributions/ownership.mjs';

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
if (options.kind === 'recurring') {
  try {
    const { reportRecurring } = await import('../../../src/lib/contributions/recurring.mjs');
    const result = await reportRecurring({
      cwd: process.cwd(),
      input: options.input,
      dryRun: options.dryRun,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  } catch (error) {
    fail(error.message, 2);
  }
}
if (options.kind === 'audit') {
  try {
    const { reportAudit } = await import('../../../src/lib/audit/report.mjs');
    const result = await reportAudit({
      cwd: process.cwd(),
      input: options.input,
      dryRun: options.dryRun,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  } catch (error) {
    fail(error.message, 2);
  }
}
if (!['issue', 'pr'].includes(options.kind)) {
  fail('Usage: github-create issue|pr|audit|recurring [options]', 2);
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

let labels;
if (options.recurring_key || options.recurring_labels) {
  if (
    options.kind !== 'issue' ||
    !/^[a-z0-9][a-z0-9-]*$/.test(options.recurring_key ?? '') ||
    options.audit_check ||
    options.audit_target
  )
    fail('Recurring ownership requires one valid issue key.', 2);
  let additional;
  try {
    additional = JSON.parse(options.recurring_labels ?? '[]');
  } catch {
    fail('Invalid recurring labels.', 2);
  }
  if (
    !Array.isArray(additional) ||
    additional.some(
      (name) =>
        typeof name !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9 .:_-]{0,49}$/.test(name) ||
        ownershipLabel(name),
    )
  )
    fail('Invalid recurring labels.', 2);
  labels = [
    ...new Set([label, 'recurring-owned', `recurring:${options.recurring_key}`, ...additional]),
  ];
}
if (options.audit_check || options.audit_target) {
  if (options.kind !== 'issue' || options.type !== 'bug')
    fail('Audit ownership requires a bug issue.', 2);
  if (!['links', 'lighthouse', 'dependencies'].includes(options.audit_check))
    fail('Invalid audit check.', 2);
  if (!['local', 'production'].includes(options.audit_target)) fail('Invalid audit target.', 2);
  labels = [label, 'audit-owned', `audit:${options.audit_check}`, `target:${options.audit_target}`];
}

const preview = {
  valid: true,
  kind: options.kind,
  title: options.title,
  body,
  ...(label ? { label } : {}),
  ...(labels ? { labels } : {}),
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
    ...(labels ?? [label]).flatMap((value) => ['--label', value]),
    ...(options.repo ? ['--repo', options.repo] : []),
  ]);
  const stored = JSON.parse(
    run('gh', [
      'issue',
      'view',
      url,
      '--json',
      labels ? 'number,title,body,url,labels' : 'number,title,body,url',
      ...(options.repo ? ['--repo', options.repo] : []),
    ]),
  );
  verifyStored(preview, stored);
  if (labels && !hasLabels(stored.labels, labels))
    fail('GitHub stored issue labels differ from the verified preview.', 2);
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
