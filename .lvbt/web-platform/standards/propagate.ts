import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const OWNER = 'LasVegasForTransit';
export const BRANCH_PREFIX = 'automation/repository-standard-';
const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

export interface RegistryEntry {
  name: string;
  requiredStatus: string;
  kind: 'source' | 'template' | 'consumer';
  example?: string;
}

export interface Registry {
  version: number;
  repositories: RegistryEntry[];
  exceptions: RegistryException[];
}

export interface RegistryException {
  repository: string;
  rule: string;
  reason: string;
  expires: string;
}

export interface OpenUpdate {
  number: number;
  headRefName: string;
}

export async function readRegistry(
  file = path.join(import.meta.dirname, 'repositories.json'),
): Promise<Registry> {
  return JSON.parse(await readFile(file, 'utf8')) as Registry;
}

/** Repositories that receive each release: every template and consumer, never the source. */
export function propagationTargets(registry: Registry): RegistryEntry[] {
  return registry.repositories.filter(({ kind }) => kind !== 'source');
}

export function parseRelease(tag: string): [number, number, number] {
  const match = STABLE_TAG.exec(tag);
  if (!match) throw new Error(`Propagation requires a stable release tag, not ${tag}.`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareReleases(left: string, right: string): number {
  const a = parseRelease(left);
  const b = parseRelease(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function latestRelease(tags: string[]): string | undefined {
  return tags
    .filter((tag) => STABLE_TAG.test(tag))
    .sort(compareReleases)
    .at(-1);
}

/**
 * Whether moving from one release to another is a patch: fixes only, so its update merges itself.
 * A minor or major step can change behavior, so a maintainer merges it after reading the notes.
 */
export function isPatchUpdate(from: string | null | undefined, to: string): boolean {
  if (!from || !STABLE_TAG.test(from)) return false;
  const [fromMajor, fromMinor] = parseRelease(from);
  const [toMajor, toMinor] = parseRelease(to);
  return fromMajor === toMajor && fromMinor === toMinor && compareReleases(to, from) > 0;
}

export function updateBranch(tag: string): string {
  parseRelease(tag);
  return `${BRANCH_PREFIX}${tag}`;
}

/**
 * Decides what to do with the update pull requests already open in a repository. Older releases
 * are closed as superseded; a newer one means this release must not be proposed at all.
 */
export function planOpenUpdates(open: OpenUpdate[], tag: string) {
  const current = updateBranch(tag);
  const superseded: OpenUpdate[] = [];
  const newer: OpenUpdate[] = [];
  for (const update of open) {
    if (!update.headRefName.startsWith(BRANCH_PREFIX) || update.headRefName === current) continue;
    const release = update.headRefName.slice(BRANCH_PREFIX.length);
    if (!STABLE_TAG.test(release)) continue;
    if (compareReleases(release, tag) < 0) superseded.push(update);
    else newer.push(update);
  }
  return { superseded, newer };
}

export function releaseNotesPath(tag: string): string {
  return `docs/reference/release-${tag.slice(1).replaceAll('.', '-')}.md`;
}

export function pullRequestTitle(tag: string): string {
  return `chore: update LVBT repository standard to ${tag}`;
}

export function pullRequestBody(options: {
  tag: string;
  kind: RegistryEntry['kind'];
  hasNotes: boolean;
  automerge: boolean;
}): string {
  const { tag, kind, hasNotes, automerge } = options;
  const source = `https://github.com/${OWNER}/repository-tooling`;
  const notes = hasNotes
    ? `The [release notes](${source}/blob/${tag}/${releaseNotesPath(tag)}) say what changes for a repository that updates.`
    : `The [${tag} release](${source}/releases/tag/${tag}) describes what changed.`;
  const change =
    kind === 'template'
      ? `The files are generated from the reviewed ${tag} example in repository-tooling.`
      : `The vendored standard in \`.lvbt/web-platform/\` is replaced by ${tag}, and the release's own migrations update the files it manages.`;
  return [
    '# TL;DR',
    '',
    `Moves this repository to LVBT repository standard ${tag}.`,
    '',
    '# Overview of Changes',
    '',
    `${change} ${notes}`,
    '',
    automerge
      ? "This pull request was opened by this repository's `Standard update` workflow. It is a patch release, so it merges itself once `Validate` passes. If `Validate` fails, fix the repository on this branch; a newer release closes this pull request and opens its own."
      : "This pull request was opened by this repository's `Standard update` workflow. It is a minor release, which can change how the repository works, so a maintainer merges it after reading the release notes. If `Validate` fails, fix the repository on this branch; a newer release closes this pull request and opens its own.",
    '',
    '# Follow-ups',
    '',
    'None.',
    '',
  ].join('\n');
}

export function commitMessage(tag: string): string {
  return `${pullRequestTitle(tag)}\n\nApply the reviewed ${tag} release with its own updater.\n`;
}

export type Runner = (command: string, args: string[], cwd: string) => string;

/** Writes a file for git or gh to read, outside the checkout so no repository check sees it. */
export async function withTemporaryFile<T>(content: string, use: (file: string) => T | Promise<T>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lvbt-propagate-'));
  try {
    const file = path.join(directory, 'content');
    await writeFile(file, content);
    return await use(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const WORKFLOWS = '.github/workflows';

export const run: Runner = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();

async function currentRelease(target: string): Promise<string | null> {
  const file = path.join(target, '.lvbt/web-platform.json');
  if (!existsSync(file)) return null;
  const { release } = JSON.parse(await readFile(file, 'utf8')) as { release: string | null };
  return release;
}

/**
 * Regenerates a template repository from its example with the release's own publication script.
 * Publication rebuilds the lockfile too; keeping the published one makes pnpm resolve only what the
 * release changed, so a re-run with no new release proposes nothing.
 */
async function publishTemplate(options: {
  source: string;
  target: string;
  entry: RegistryEntry;
  tag: string;
  runner: Runner;
}): Promise<void> {
  const { source, target, entry, tag, runner } = options;
  if (!entry.example) throw new Error(`${entry.name} is a template without an example.`);
  const lockfile = path.join(target, 'pnpm-lock.yaml');
  const published = existsSync(lockfile) ? await readFile(lockfile, 'utf8') : undefined;
  runner(
    'node',
    [
      path.join(source, 'standards/template-publication.ts'),
      '--source',
      source,
      '--target',
      target,
      '--example',
      entry.example,
      '--release',
      tag,
    ],
    target,
  );
  if (published !== undefined) await writeFile(lockfile, published);
}

/**
 * Applies a release to one checked-out repository with the release's own scripts and commits the
 * result on the release's update branch. Returns false when the repository already matches.
 */
export async function applyRelease(options: {
  source: string;
  target: string;
  entry: RegistryEntry;
  tag: string;
  install?: boolean;
  skipWorkflows?: boolean;
  runner?: Runner;
}): Promise<{
  changed: boolean;
  from?: string | null | undefined;
  reason?: string;
  skippedWorkflows?: string[];
}> {
  const { entry, tag, install = true, skipWorkflows = false, runner = run } = options;
  // A release's scripts only run as entry points when invoked by their real path.
  const source = realpathSync(options.source);
  const target = realpathSync(options.target);
  parseRelease(tag);
  const release = await currentRelease(target);
  if (release && STABLE_TAG.test(release) && compareReleases(release, tag) > 0) {
    return { changed: false, reason: `${entry.name} is already on ${release}, newer than ${tag}.` };
  }

  if (entry.kind === 'template') await publishTemplate({ source, target, entry, tag, runner });
  else if (entry.kind === 'consumer')
    runner(
      'node',
      [
        path.join(source, 'standards/web-platform-cli.ts'),
        'update',
        '--root',
        target,
        '--source',
        source,
        '--release',
        tag,
        '--apply',
        '--json',
      ],
      target,
    );
  else throw new Error(`${entry.name} does not receive releases.`);

  if (install) runner('pnpm', ['install', '--lockfile-only', '--no-frozen-lockfile'], target);
  const skippedWorkflows = skipWorkflows ? restoreWorkflows(target, runner) : [];
  if (!runner('git', ['status', '--porcelain'], target))
    return { changed: false, from: release, skippedWorkflows };

  runner('git', ['switch', '-C', updateBranch(tag)], target);
  runner('git', ['restore', '--staged', '.'], target);
  runner('git', ['add', '-A'], target);
  await withTemporaryFile(commitMessage(tag), (message) =>
    runner(
      'git',
      [
        '-c',
        'user.name=lvbt-bot',
        '-c',
        'user.email=noreply@lasvegasfortransit.org',
        'commit',
        '--quiet',
        '--no-verify',
        '-F',
        message,
      ],
      target,
    ),
  );
  return { changed: true, from: release, skippedWorkflows };
}

/**
 * A repository's own GITHUB_TOKEN may not push workflow files, so a self-update leaves them as they
 * are and reports which ones the release changed; a maintainer copies those by hand.
 */
function restoreWorkflows(target: string, runner: Runner): string[] {
  const changed = runner('git', ['status', '--porcelain', '--', WORKFLOWS], target)
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
  if (changed.length === 0) return [];
  runner('git', ['checkout', '--quiet', 'HEAD', '--', WORKFLOWS], target);
  runner('git', ['clean', '--quiet', '--force', '--', WORKFLOWS], target);
  return changed;
}
