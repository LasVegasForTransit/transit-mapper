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
import { renderPullRequestBody, validateMetadata } from './validation.js';

interface StoredPullRequest {
  number: number;
  url: string;
  title: string;
  body: string;
  isDraft: boolean;
  headRefName: string;
}

interface PreparedPullRequest {
  title: string;
  body: string;
  base: string;
  draft: boolean;
}

function pullRequestNumber(url: string): number | undefined {
  const value = Number(url.trim().split('/').at(-1));
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function pushedBranch(runCommand: CommandRunner): Promise<string> {
  const branch = await runCommand('git', ['branch', '--show-current']);
  if (branch.exitCode !== 0 || !branch.stdout.trim())
    throw new Error('The current branch could not be determined.');
  const name = branch.stdout.trim();
  const upstream = await runCommand('git', [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  if (upstream.exitCode !== 0 || !upstream.stdout.trim().endsWith(`/${name}`)) {
    throw new Error('The current branch must have a matching pushed upstream branch.');
  }
  const ahead = await runCommand('git', ['rev-list', '--count', '@{upstream}..HEAD']);
  if (ahead.exitCode !== 0 || ahead.stdout.trim() !== '0') {
    throw new Error('Push every local commit before creating the pull request.');
  }
  return name;
}

function preparePullRequest(
  payload: Record<string, unknown>,
  json: boolean,
): PreparedPullRequest | CliResult {
  const title = payload.title;
  const sections = stringSections(payload.sections);
  const draft = payload.draft === true;
  if (typeof title !== 'string' || !sections) {
    return runtimeFailure('The pull request payload requires title and string section values.');
  }
  const body = renderPullRequestBody({ sections });
  const validation = validateMetadata({ kind: 'pull-request', title, body, draft });
  if (!validation.valid) return policyFailure(validation.errors, json);
  return {
    title,
    body,
    draft,
    base: typeof payload.base === 'string' ? payload.base : 'main',
  };
}

function createArguments(pullRequest: PreparedPullRequest, head: string): string[] {
  const args = [
    'pr',
    'create',
    '--head',
    head,
    '--base',
    pullRequest.base,
    '--title',
    pullRequest.title,
    '--body-file',
    '-',
  ];
  if (pullRequest.draft) args.push('--draft');
  return args;
}

async function persistPullRequest(
  pullRequest: PreparedPullRequest,
  head: string,
  json: boolean,
  runCommand: CommandRunner,
): Promise<CliResult> {
  const created = await runCommand('gh', createArguments(pullRequest, head), pullRequest.body);
  if (created.exitCode !== 0)
    return runtimeFailure(`gh pr create failed: ${created.stderr.trim()}`);
  const number = pullRequestNumber(created.stdout);
  if (!number) return runtimeFailure('GitHub did not return a recognizable pull request URL.');
  const fetched = await runCommand('gh', [
    'pr',
    'view',
    String(number),
    '--json',
    'number,url,title,body,isDraft,headRefName',
  ]);
  if (fetched.exitCode !== 0) return runtimeFailure(`gh pr view failed: ${fetched.stderr.trim()}`);
  const storedObject = objectValue(JSON.parse(fetched.stdout) as unknown);
  if (!storedObject) return runtimeFailure('GitHub returned malformed pull request metadata.');
  const stored = storedObject as unknown as StoredPullRequest;
  const storedValidation = validateMetadata({
    kind: 'pull-request',
    title: stored.title,
    body: stored.body,
    draft: stored.isDraft,
  });
  if (!storedValidation.valid || stored.headRefName !== head) {
    return runtimeFailure(
      'The stored pull request does not satisfy the contribution metadata contract.',
    );
  }
  const output = { valid: true, errors: [], number: stored.number, url: stored.url };
  return { exitCode: 0, stdout: json ? jsonOutput(output) : `${stored.url}\n`, stderr: '' };
}

export async function runCreatePullRequestCli(
  args: string[],
  readText: ReadText,
  runCommand: CommandRunner,
): Promise<CliResult> {
  const parsed = parseCreateArguments(args, 'github:create-pr');
  if (isCliResult(parsed)) return parsed;

  try {
    const payload = await readJsonObject(parsed.input, readText);
    const pullRequest = preparePullRequest(payload, parsed.json);
    if (isCliResult(pullRequest)) return pullRequest;

    const head = await pushedBranch(runCommand);
    if (parsed.dryRun) {
      const preview = { valid: true, errors: [], dryRun: true, ...pullRequest, head };
      return {
        exitCode: 0,
        stdout: parsed.json ? jsonOutput(preview) : `${pullRequest.body}\n`,
        stderr: '',
      };
    }
    return await persistPullRequest(pullRequest, head, parsed.json, runCommand);
  } catch (caught) {
    return runtimeFailure(caught instanceof Error ? caught.message : String(caught));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeCliResult(
    await runCreatePullRequestCli(process.argv.slice(2), defaultReadText, defaultCommandRunner),
  );
}
