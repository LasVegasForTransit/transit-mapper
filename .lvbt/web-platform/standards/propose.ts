import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  type OpenUpdate,
  type RegistryEntry,
  type Runner,
  applyRelease,
  isPatchUpdate,
  planOpenUpdates,
  propagationTargets,
  readRegistry,
  pullRequestBody,
  pullRequestTitle,
  releaseNotesPath,
  run,
  updateBranch,
  withTemporaryFile,
} from './propagate.ts';

/**
 * Compares the freshly generated update commit with the branch already on GitHub. A branch that
 * carries someone's fix is kept; a bot-only branch is replaced when the base or the result moved.
 */
function remoteBranchState(
  target: string,
  branch: string,
  runner: Runner,
): 'absent' | 'current' | 'stale' | 'edited' {
  if (!runner('git', ['ls-remote', '--heads', 'origin', branch], target)) return 'absent';
  runner(
    'git',
    ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
    target,
  );
  const authors = runner('git', ['log', '--format=%ae', `HEAD^..origin/${branch}`], target).split(
    '\n',
  );
  if (authors.some((author) => author !== 'noreply@lasvegasfortransit.org')) return 'edited';
  const same = (ref: string) =>
    runner('git', ['rev-parse', `origin/${branch}${ref}`], target) ===
    runner('git', ['rev-parse', `HEAD${ref}`], target);
  return same('^') && same('^{tree}') ? 'current' : 'stale';
}

function openUpdates(target: string, runner: Runner): OpenUpdate[] {
  return JSON.parse(
    runner(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'open',
        '--base',
        'main',
        '--json',
        'number,headRefName',
        '--limit',
        '100',
      ],
      target,
    ),
  ) as OpenUpdate[];
}

/**
 * Pushes a new or rebuilt update branch, or adopts the one on GitHub when it is current or fixed.
 * Returns true when it pushed.
 */
function pushUpdateBranch(target: string, name: string, branch: string, runner: Runner): boolean {
  const state = remoteBranchState(target, branch, runner);
  if (state === 'absent' || state === 'stale') {
    runner('git', ['push', '--force-with-lease', '--set-upstream', 'origin', branch], target);
    return true;
  }
  if (state === 'edited') {
    process.stdout.write(`${name}: keeping the fixes already pushed to ${branch}.\n`);
    runner('git', ['reset', '--quiet', '--hard', `origin/${branch}`], target);
  }
  runner('git', ['branch', '--set-upstream-to', `origin/${branch}`], target);
  return false;
}

/** Opens the update pull request with the shared helper, or refreshes the one already open. */
async function openPullRequest(options: {
  source: string;
  tooling: string;
  target: string;
  entry: RegistryEntry;
  tag: string;
  automerge: boolean;
  runner: Runner;
}): Promise<number> {
  const { source, tooling, target, entry, tag, automerge, runner } = options;
  const title = pullRequestTitle(tag);
  const hasNotes = existsSync(path.join(source, releaseNotesPath(tag)));
  const content = pullRequestBody({ tag, kind: entry.kind, hasNotes, automerge });
  return withTemporaryFile(content, (body) =>
    createOrEdit({ tooling, target, tag, title, body, runner }),
  );
}

function createOrEdit(options: {
  tooling: string;
  target: string;
  tag: string;
  title: string;
  body: string;
  runner: Runner;
}): number {
  const { tooling, target, tag, title, body, runner } = options;
  const existing = JSON.parse(
    runner(
      'gh',
      ['pr', 'list', '--head', updateBranch(tag), '--state', 'open', '--json', 'number'],
      target,
    ),
  ) as { number: number }[];
  if (existing[0]) {
    runner(
      'gh',
      ['pr', 'edit', String(existing[0].number), '--title', title, '--body-file', body],
      target,
    );
    return existing[0].number;
  }
  const helper = path.join(
    tooling,
    'packages/cli/plugins/lvbt-contributions/scripts/github-create.mjs',
  );
  const args = [helper, 'pr', '--title', title, '--body-file', body, '--base', 'main', '--json'];
  runner('node', [...args, '--dry-run'], target);
  return (JSON.parse(runner('node', args, target)) as { number: number }).number;
}

/**
 * Pushes the update branch, opens or refreshes its pull request, enables auto-merge, and closes
 * update pull requests for older releases.
 */
export async function proposeRelease(options: {
  source: string;
  tooling: string;
  target: string;
  entry: RegistryEntry;
  tag: string;
  changed: boolean;
  from?: string | null | undefined;
  runner?: Runner;
}): Promise<string | undefined> {
  const { target, entry, tag, changed, from, runner = run } = options;
  const automerge = isPatchUpdate(from, tag);
  const open = openUpdates(target, runner);
  const { superseded, newer } = planOpenUpdates(open, tag);
  if (newer.length > 0) {
    process.stdout.write(`${entry.name}: a newer update is already open (#${newer[0]?.number}).\n`);
    return undefined;
  }

  let number: number | undefined;
  if (changed) {
    const pushed = pushUpdateBranch(target, entry.name, updateBranch(tag), runner);
    number = await openPullRequest({ ...options, automerge, runner });
    if (automerge) runner('gh', ['pr', 'merge', String(number), '--auto', '--rebase'], target);
    // A push made with a repository's own GITHUB_TOKEN starts no workflow, but a dispatch always
    // does, and its Validate check lands on the branch's head commit.
    if (pushed) runner('gh', ['workflow', 'run', 'ci.yml', '--ref', updateBranch(tag)], target);
  } else {
    superseded.push(...open.filter(({ headRefName }) => headRefName === updateBranch(tag)));
  }

  for (const update of superseded) {
    const comment = number
      ? `Superseded by #${number}, which updates to ${tag}.`
      : `Superseded: this repository already matches ${tag}.`;
    runner(
      'gh',
      ['pr', 'close', String(update.number), '--comment', comment, '--delete-branch'],
      target,
    );
  }
  return number ? `${entry.name}: #${number}` : `${entry.name}: already on ${tag}`;
}

/**
 * Applies a release to a local checkout and proposes it, as a repository's own `Standard update`
 * workflow would. A maintainer uses it to give a repository its first `standard-update.yml`, which
 * that workflow's token cannot add.
 */
export async function main(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      source: { type: 'string' },
      target: { type: 'string' },
      repository: { type: 'string' },
      release: { type: 'string' },
      'dry-run': { type: 'boolean' },
    },
  });
  if (!values.source || !values.target || !values.repository || !values.release) {
    throw new Error(
      'Usage: --source <release checkout> --target <repository checkout> --repository <name> --release <tag> [--dry-run]',
    );
  }
  const registry = await readRegistry();
  const entry = propagationTargets(registry).find(({ name }) => name === values.repository);
  if (!entry)
    throw new Error(`${values.repository} is not a propagation target in repositories.json.`);

  const source = path.resolve(values.source);
  const target = path.resolve(values.target);
  const result = await applyRelease({ source, target, entry, tag: values.release });
  if (result.reason) {
    process.stdout.write(`${result.reason}\n`);
    return;
  }
  if (values['dry-run']) {
    process.stdout.write(
      result.changed
        ? `${entry.name}: committed ${values.release} on ${updateBranch(values.release)}; not pushed (dry run).\n`
        : `${entry.name}: already matches ${values.release}.\n`,
    );
    return;
  }
  const outcome = await proposeRelease({
    source,
    tooling: path.resolve(import.meta.dirname, '..'),
    target,
    entry,
    tag: values.release,
    changed: result.changed,
    from: result.from,
  });
  if (outcome) process.stdout.write(`${outcome}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
