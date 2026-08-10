#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  type CommandRunner,
  defaultCommandRunner,
  objectValue,
  runtimeFailure,
  writeCliResult,
} from './cli-support.js';
import {
  type IssueComment,
  type IssueOperation,
  planIssueReconciliation,
} from './issue-reconciliation.js';
import { validateGitHubEvent } from './event-validation.js';

interface IssueEventDetails {
  repository: string;
  number: number;
  labels: string[];
}

function eventDetails(event: Record<string, unknown>): IssueEventDetails | undefined {
  const repository = objectValue(event.repository);
  const issue = objectValue(event.issue);
  const labels = Array.isArray(issue?.labels) ? issue.labels : [];
  if (typeof repository?.full_name !== 'string' || typeof issue?.number !== 'number')
    return undefined;
  return {
    repository: repository.full_name,
    number: issue.number,
    labels: labels
      .map((label) => objectValue(label)?.name)
      .filter((name): name is string => typeof name === 'string'),
  };
}

function commentsFrom(value: unknown): IssueComment[] {
  const pages: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
  const comments: unknown[] = pages.flatMap((page): unknown[] =>
    Array.isArray(page) ? (page as unknown[]) : [page],
  );
  return comments.flatMap((value): IssueComment[] => {
    const comment = objectValue(value);
    const user = objectValue(comment?.user);
    return typeof comment?.id === 'number' &&
      typeof comment.body === 'string' &&
      typeof user?.login === 'string'
      ? [{ id: comment.id, body: comment.body, author: user.login }]
      : [];
  });
}

async function applyOperation(
  operation: IssueOperation,
  details: IssueEventDetails,
  runCommand: CommandRunner,
): Promise<void> {
  let args: string[];
  let input: string | undefined;
  if (operation.type === 'add-label') {
    args = [
      'api',
      '--method',
      'POST',
      `repos/${details.repository}/issues/${details.number}/labels`,
      '--input',
      '-',
    ];
    input = JSON.stringify({ labels: [operation.label] });
  } else if (operation.type === 'remove-label') {
    args = [
      'api',
      '--method',
      'DELETE',
      `repos/${details.repository}/issues/${details.number}/labels/${operation.label}`,
    ];
  } else if (operation.type === 'create-comment') {
    args = [
      'api',
      '--method',
      'POST',
      `repos/${details.repository}/issues/${details.number}/comments`,
      '--input',
      '-',
    ];
    input = JSON.stringify({ body: operation.body });
  } else if (operation.type === 'update-comment') {
    args = [
      'api',
      '--method',
      'PATCH',
      `repos/${details.repository}/issues/comments/${operation.commentId}`,
      '--input',
      '-',
    ];
    input = JSON.stringify({ body: operation.body });
  } else {
    args = [
      'api',
      '--method',
      'DELETE',
      `repos/${details.repository}/issues/comments/${operation.commentId}`,
    ];
  }
  const result = await runCommand('gh', args, input);
  if (result.exitCode !== 0)
    throw new Error(result.stderr.trim() || `GitHub operation ${operation.type} failed.`);
}

export async function reconcileIssueEvent(
  event: Record<string, unknown>,
  runCommand: CommandRunner,
): Promise<ReturnType<typeof runtimeFailure>> {
  const details = eventDetails(event);
  if (!details) return runtimeFailure('The event does not contain repository and issue metadata.');
  const fetched = await runCommand('gh', [
    'api',
    '--paginate',
    '--slurp',
    `repos/${details.repository}/issues/${details.number}/comments`,
  ]);
  if (fetched.exitCode !== 0)
    return runtimeFailure(`Could not read issue comments: ${fetched.stderr.trim()}`);

  try {
    const operations = planIssueReconciliation({
      validation: validateGitHubEvent(event),
      labels: details.labels,
      comments: commentsFrom(JSON.parse(fetched.stdout)),
    });
    for (const operation of operations) await applyOperation(operation, details, runCommand);
    return {
      exitCode: 0,
      stdout: `${operations.length} issue metadata operation(s) applied.\n`,
      stderr: '',
    };
  } catch (caught) {
    return runtimeFailure(caught instanceof Error ? caught.message : String(caught));
  }
}

async function main(): Promise<void> {
  const eventPath = process.argv[2];
  if (!eventPath) {
    writeCliResult(runtimeFailure('Usage: reconcile-issue-cli <event-json>'));
    return;
  }
  try {
    const value: unknown = JSON.parse(await readFile(eventPath, 'utf8'));
    const event = objectValue(value);
    writeCliResult(
      event
        ? await reconcileIssueEvent(event, defaultCommandRunner)
        : runtimeFailure('The event JSON must contain an object.'),
    );
  } catch (caught) {
    writeCliResult(runtimeFailure(caught instanceof Error ? caught.message : String(caught)));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
