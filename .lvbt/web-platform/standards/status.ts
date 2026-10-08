import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  BRANCH_PREFIX,
  OWNER,
  type Registry,
  type RegistryEntry,
  compareReleases,
  latestRelease,
  readRegistry,
} from './propagate.ts';
import { inventoryPaths, processFindings, type ProcessSnapshot } from './process-contract.ts';
import { OWNED_FILES } from './owned-files.ts';

/** Days a repository may trail the latest release while its update pull request runs. */
export const GRACE_DAYS = 3;

export interface RepositoryState {
  name: string;
  kind?: RegistryEntry['kind'];
  defaultBranch?: string;
  commit?: string;
  process?: ProcessSnapshot;
  release: string | null;
  pluginRef: string | null;
  /** The repository runs `Standard update`. */
  selfUpdating: boolean;
  rulesets: string[];
  updates: { number: number; headRefName: string; failing: boolean }[];
}

export interface Finding {
  repository: string;
  rule: string;
  message: string;
  severity?: 'warning' | 'error';
}
export function hasErrors(open: Finding[]): boolean {
  return open.some(({ severity }) => severity !== 'warning');
}

export interface Release {
  tag: string;
  date: string;
}

/** Days since the first release the repository has not adopted, or 0 when it is current. */
export function daysBehind(release: string, releases: Release[], now: number): number {
  const missed = releases
    .filter(({ tag }) => compareReleases(tag, release) > 0)
    .sort((left, right) => compareReleases(left.tag, right.tag))[0];
  return missed ? (now - Date.parse(missed.date)) / 86_400_000 : 0;
}

/**
 * Compares one repository with the releases and the organization settings. Pure, so the rules are
 * tested without GitHub.
 */
function adoptionFindings(state: RepositoryState, releases: Release[], now: number): Finding[] {
  const found: Finding[] = [];
  const add = (rule: string, message: string) =>
    found.push({ repository: state.name, rule, message });
  const latest = latestRelease(releases.map(({ tag }) => tag));

  if (state.release === null) {
    add('release', 'main vendors an unreleased commit (`release: null`); merge a tagged release.');
  } else {
    const days = daysBehind(state.release, releases, now);
    if (days > GRACE_DAYS)
      add(
        'release',
        `on ${state.release} and behind ${latest ?? 'the latest release'} for ${Math.floor(days)} days.`,
      );
  }
  if (state.release && state.pluginRef !== state.release) {
    add(
      'plugin-ref',
      `.claude/settings.json pins the contribution plugin to ${state.pluginRef ?? 'nothing'}, not ${state.release}.`,
    );
  }
  if (!state.selfUpdating)
    add(
      'self-update',
      'it cannot update itself: copy .github/workflows/standard-update.yml from the example.',
    );
  return found;
}
export function findings(state: RepositoryState, releases: Release[], now: number): Finding[] {
  const found = state.kind === 'source' ? [] : adoptionFindings(state, releases, now);
  const add = (rule: string, message: string) =>
    found.push({ repository: state.name, rule, message });
  if (!state.rulesets.includes('org-standard'))
    add('ruleset', 'the org-standard ruleset is missing.');
  for (const update of state.updates) {
    if (update.failing) add('update', `update pull request #${update.number} is failing Validate.`);
  }
  if (state.process) found.push(...processFindings(state.process));
  return found;
}

/** Removes findings covered by an unexpired, documented exception in repositories.json. */
export function applyExceptions(found: Finding[], registry: Registry, today: string): Finding[] {
  return found.filter(
    (finding) =>
      !registry.exceptions.some(
        (exception) =>
          exception.repository === finding.repository &&
          exception.rule === finding.rule &&
          exception.expires >= today,
      ),
  );
}

export function report(states: RepositoryState[], latest: string, open: Finding[]): string {
  const lines = [
    `# Repository standard status`,
    '',
    `Latest release: **${latest}**.`,
    '',
    '| Repository | Default branch / commit | Release | Open update | Findings |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const state of states) {
    const mine = open.filter(({ repository }) => repository === state.name);
    const updates = state.updates.map(({ number }) => `#${number}`).join(', ') || '—';
    const summary =
      mine.map(({ message, severity }) => `${severity ?? 'error'}: ${message}`).join('<br>') ||
      'none';
    lines.push(
      `| ${state.name} | ${state.defaultBranch ?? '—'} / ${state.commit ?? '—'} | ${state.release ?? 'unreleased'} | ${updates} | ${summary} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

const gh = (args: string[]) =>
  execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function readRaw(repository: string, file: string, ref: string, read = gh): string | null {
  try {
    return read([
      'api',
      `repos/${OWNER}/${repository}/contents/${file}?ref=${encodeURIComponent(ref)}`,
      '-H',
      'Accept: application/vnd.github.raw',
    ]);
  } catch {
    return null;
  }
}

export function pluginRef(settings: string | null): string | null {
  if (!settings) return null;
  const parsed = JSON.parse(settings) as {
    extraKnownMarketplaces?: Record<string, { source?: { repo?: string; ref?: string } }>;
  };
  const marketplace = Object.values(parsed.extraKnownMarketplaces ?? {}).find(
    ({ source }) => source?.repo === `${OWNER}/repository-tooling`,
  );
  return marketplace?.source?.ref ?? null;
}

function readFiles(repository: string, commit: string, paths: string[], read: typeof gh) {
  const requested = inventoryPaths(paths);
  requested.push(...OWNED_FILES.map((file) => `.lvbt/web-platform/examples/with-astro/${file}`));
  return Object.fromEntries(
    requested.map((file) => {
      const content = paths.includes(file) ? readRaw(repository, file, commit, read) : null;
      if (paths.includes(file) && content === null)
        throw new Error(
          `Cannot inventory ${repository}/${file} at ${commit}; GitHub contents are unavailable.`,
        );
      return [file, content];
    }),
  );
}
export function readState(entry: RegistryEntry, read = gh): RepositoryState {
  const repository = JSON.parse(read(['api', `repos/${OWNER}/${entry.name}`])) as {
    default_branch: string;
  };
  const commit = (
    JSON.parse(
      read([
        'api',
        `repos/${OWNER}/${entry.name}/commits/${encodeURIComponent(repository.default_branch)}`,
      ]),
    ) as { sha: string }
  ).sha;
  const tree = JSON.parse(
    read(['api', `repos/${OWNER}/${entry.name}/git/trees/${commit}?recursive=1`]),
  ) as { truncated: boolean; tree: { path: string; type: string }[] };
  if (tree.truncated)
    throw new Error(`${entry.name}: inventory tree is truncated; refusing incomplete findings.`);
  const paths = tree.tree.filter(({ type }) => type === 'blob').map(({ path }) => path);
  const files = readFiles(entry.name, commit, paths, read);
  const manifest = files['.lvbt/web-platform.json'];
  const release =
    entry.kind === 'source'
      ? `v${(JSON.parse(files['package.json'] ?? '{}') as { version?: string }).version ?? 'unknown'}`
      : manifest
        ? (JSON.parse(manifest) as { release: string | null }).release
        : null;
  const rulesets = (
    JSON.parse(read(['api', `repos/${OWNER}/${entry.name}/rulesets`])) as { name: string }[]
  ).map(({ name }) => name);
  const pulls = JSON.parse(
    read([
      'pr',
      'list',
      '--repo',
      `${OWNER}/${entry.name}`,
      '--state',
      'open',
      '--json',
      'number,headRefName,statusCheckRollup',
      '--limit',
      '100',
    ]),
  ) as {
    number: number;
    headRefName: string;
    statusCheckRollup: { name?: string; context?: string; conclusion?: string; state?: string }[];
  }[];
  const updates = pulls
    .filter(({ headRefName }) => headRefName.startsWith(BRANCH_PREFIX))
    .map(({ number, headRefName, statusCheckRollup }) => ({
      number,
      headRefName,
      failing: statusCheckRollup.some(
        (check) =>
          (check.name ?? check.context) === entry.requiredStatus &&
          ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(
            check.conclusion ?? check.state ?? '',
          ),
      ),
    }));
  return {
    name: entry.name,
    kind: entry.kind,
    defaultBranch: repository.default_branch,
    commit,
    process: { name: entry.name, kind: entry.kind, files, paths },
    release,
    pluginRef: pluginRef(files['.claude/settings.json'] ?? null),
    selfUpdating: typeof files['.github/workflows/standard-update.yml'] === 'string',
    rulesets,
    updates,
  };
}

function readReleases(): Release[] {
  const query = `query {
    repository(owner: "${OWNER}", name: "repository-tooling") {
      refs(refPrefix: "refs/tags/", first: 100) {
        nodes {
          name
          target {
            ... on Commit { committedDate }
            ... on Tag { target { ... on Commit { committedDate } } }
          }
        }
      }
    }
  }`;
  const nodes = (
    JSON.parse(gh(['api', 'graphql', '-f', `query=${query}`])) as {
      data: {
        repository: {
          refs: {
            nodes: {
              name: string;
              target: { committedDate?: string; target?: { committedDate?: string } };
            }[];
          };
        };
      };
    }
  ).data.repository.refs.nodes;
  return nodes
    .filter(({ name }) => /^v\d+\.\d+\.\d+$/.test(name))
    .map(({ name, target }) => ({
      tag: name,
      date: target.committedDate ?? target.target?.committedDate ?? '',
    }));
}

export async function main(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' } } });
  const registry = await readRegistry();
  const releases = readReleases();
  const latest = latestRelease(releases.map(({ tag }) => tag));
  if (!latest) throw new Error('repository-tooling has no stable release tag.');
  const states = registry.repositories.map((entry) => readState(entry));
  const now = Date.now();
  const open = applyExceptions(
    states.flatMap((state) => findings(state, releases, now)),
    registry,
    new Date(now).toISOString().slice(0, 10),
  );
  const output = values.json
    ? `${JSON.stringify({ latest, states, findings: open }, null, 2)}\n`
    : report(states, latest, open);
  process.stdout.write(output);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, report(states, latest, open));
  if (hasErrors(open)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
