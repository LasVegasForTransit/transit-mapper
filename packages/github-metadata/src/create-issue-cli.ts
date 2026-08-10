#!/usr/bin/env tsx
import { pathToFileURL } from 'node:url';

import {
  type CliResult,
  type CommandRunner,
  type ReadText,
  defaultCommandRunner,
  defaultReadText,
  isCliResult,
  jsonOutput,
  objectValue,
  parseCreateArguments,
  policyFailure,
  readJsonObject,
  runtimeFailure,
  stringSections,
  writeCliResult,
} from './cli-support.js';
import { renderIssueBody, validateMetadata } from './validation.js';

interface StoredIssue {
  number: number;
  url: string;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
}

interface PreparedIssue {
  title: string;
  body: string;
  label: 'bug' | 'enhancement';
}

function issueNumber(url: string): number | undefined {
  const value = Number(url.trim().split('/').at(-1));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function prepareIssue(payload: Record<string, unknown>, json: boolean): PreparedIssue | CliResult {
  const template = payload.template;
  const title = payload.title;
  const sections = stringSections(payload.sections);
  if ((template !== 'bug' && template !== 'idea') || typeof title !== 'string' || !sections) {
    return runtimeFailure('The issue payload requires template, title, and string section values.');
  }
  const body = renderIssueBody({ template, sections });
  const validation = validateMetadata({ kind: 'issue', title, body });
  if (!validation.valid) return policyFailure(validation.errors, json);
  return { title, body, label: template === 'bug' ? 'bug' : 'enhancement' };
}

async function persistIssue(
  issue: PreparedIssue,
  json: boolean,
  runCommand: CommandRunner,
): Promise<CliResult> {
  const created = await runCommand(
    'gh',
    ['issue', 'create', '--title', issue.title, '--label', issue.label, '--body-file', '-'],
    issue.body,
  );
  if (created.exitCode !== 0)
    return runtimeFailure(`gh issue create failed: ${created.stderr.trim()}`);
  const number = issueNumber(created.stdout);
  if (!number) return runtimeFailure('GitHub did not return a recognizable issue URL.');

  const fetched = await runCommand('gh', [
    'issue',
    'view',
    String(number),
    '--json',
    'number,url,title,body,labels',
  ]);
  if (fetched.exitCode !== 0)
    return runtimeFailure(`gh issue view failed: ${fetched.stderr.trim()}`);
  const storedObject = objectValue(JSON.parse(fetched.stdout) as unknown);
  if (!storedObject) return runtimeFailure('GitHub returned malformed issue metadata.');
  const stored = storedObject as unknown as StoredIssue;
  const storedValidation = validateMetadata({
    kind: 'issue',
    title: stored.title,
    body: stored.body,
  });
  if (!storedValidation.valid || !stored.labels.some((item) => item.name === issue.label)) {
    return runtimeFailure('The stored issue does not satisfy the contribution metadata contract.');
  }
  const output = { valid: true, errors: [], number: stored.number, url: stored.url };
  return { exitCode: 0, stdout: json ? jsonOutput(output) : `${stored.url}\n`, stderr: '' };
}

export async function runCreateIssueCli(
  args: string[],
  readText: ReadText,
  runCommand: CommandRunner,
): Promise<CliResult> {
  const parsed = parseCreateArguments(args, 'github:create-issue');
  if (isCliResult(parsed)) return parsed;

  try {
    const payload = await readJsonObject(parsed.input, readText);
    const issue = prepareIssue(payload, parsed.json);
    if (isCliResult(issue)) return issue;

    if (parsed.dryRun) {
      const preview = { valid: true, errors: [], dryRun: true, ...issue };
      return {
        exitCode: 0,
        stdout: parsed.json ? jsonOutput(preview) : `${issue.body}\n`,
        stderr: '',
      };
    }
    return await persistIssue(issue, parsed.json, runCommand);
  } catch (caught) {
    return runtimeFailure(caught instanceof Error ? caught.message : String(caught));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeCliResult(
    await runCreateIssueCli(process.argv.slice(2), defaultReadText, defaultCommandRunner),
  );
}
