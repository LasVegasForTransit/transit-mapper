import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCommand } from './shell.js';

/**
 * The REST API version this tooling was written against.
 *
 * GitHub serves a default version that moves over time, so a script that
 * omits the header silently changes behaviour on GitHub's schedule rather
 * than on ours. Pinning it means an upgrade is a commit.
 */
const API_VERSION = '2022-11-28';

export interface GhResult {
  ok: boolean;
  /** Parsed JSON when the response was JSON, otherwise the raw text. */
  data: unknown;
  /** stderr when the call failed. */
  error: string;
}

/** Calls `gh api` with the pinned version header, optionally with a body. */
export function ghApi(args: string, body?: unknown): GhResult {
  let file: string | undefined;
  let command = `gh api -H "X-GitHub-Api-Version: ${API_VERSION}" ${args}`;
  if (body !== undefined) {
    file = path.join(tmpdir(), `gh-body.${process.pid}.${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(body), 'utf8');
    command += ` --input ${file}`;
  }
  const result = runCommand(command);
  if (file) unlinkSync(file);
  if (!result.ok) return { ok: false, data: null, error: result.stderr };
  try {
    return { ok: true, data: JSON.parse(result.stdout) as unknown, error: '' };
  } catch {
    return { ok: true, data: result.stdout.trim(), error: '' };
  }
}

/**
 * Whether the authenticated user can change repository settings.
 *
 * Checked before anything else, because without it every subsequent call
 * fails with a 404 rather than a 403 — GitHub hides the existence of
 * settings you cannot administer, so the errors read as "no such repository"
 * and send the reader somewhere useless.
 */
export function canAdminister(): boolean {
  const result = runCommand('gh repo view --json viewerCanAdminister --jq .viewerCanAdminister');
  return result.ok && result.stdout.trim() === 'true';
}

/** Whether the repository belongs to an organization rather than a user. */
export function isOrganizationOwned(): boolean {
  const result = ghApi('repos/:owner/:repo --jq .owner.type');
  return result.data === 'Organization';
}

interface Ruleset {
  id: number;
  name: string;
}

/**
 * Finds a ruleset by name.
 *
 * `includes_parents=false` restricts the result to rulesets defined on this
 * repository. Without it the list also carries rulesets inherited from the
 * organization, which cannot be updated through the repository endpoint —
 * so a match against one produces an update that fails, or worse, a second
 * repository-level ruleset shadowing it.
 */
export function findRuleset(name: string): Ruleset | null {
  const listed = ghApi('"repos/:owner/:repo/rulesets?includes_parents=false&per_page=100"');
  if (!listed.ok || !Array.isArray(listed.data)) return null;
  return (listed.data as Ruleset[]).find((r) => r.name === name) ?? null;
}

interface RuleShape {
  readonly type: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/** Readonly throughout, so the standard can be declared `as const` and stay
 *  immutable at its definition rather than only by convention. */
interface RulesetBody {
  readonly enforcement?: string;
  readonly rules?: readonly RuleShape[];
}

/**
 * Parameters the standard declares that the live rule does not match.
 *
 * Only declared keys are compared. GitHub populates parameters the standard
 * never mentions — a `pull_request` rule comes back carrying
 * `required_reviewers: []`, a `required_status_checks` rule carries
 * `do_not_enforce_on_create: false` — and comparing whole objects reports
 * those as drift on a repository that is configured exactly right. A check
 * that fires on a correct repository is worse than no check: it is read once,
 * disbelieved, and then ignored when it finally means something.
 *
 * The trade is that a field the standard does not name is a field this does
 * not police. That is the same statement as the standard being the standard.
 */
function parameterDifferences(actual: RuleShape, desired: RuleShape): string[] {
  const live = actual.parameters ?? {};
  const want = desired.parameters ?? {};
  const differences: string[] = [];
  for (const [key, value] of Object.entries(want)) {
    // JSON comparison because values include arrays (allowed merge methods,
    // required checks) where element order is meaningful and set semantics
    // would hide a reordering that GitHub itself treats as a change.
    if (JSON.stringify(live[key]) !== JSON.stringify(value)) {
      differences.push(
        `rule "${desired.type}": ${key} is ${JSON.stringify(live[key])}, ` +
          `standard requires ${JSON.stringify(value)}`,
      );
    }
  }
  return differences;
}

export interface RulesetDrift {
  /** Human-readable differences. Empty when the ruleset matches. */
  differences: string[];
}

/**
 * Compares a ruleset's actual contents against the desired body.
 *
 * Presence of a ruleset with the right name is not evidence that it enforces
 * anything: every rule inside it can be removed while the name remains. This
 * is the difference between reporting a setting as configured and reporting
 * it as correct.
 */
export function rulesetDrift(id: number, desired: RulesetBody): RulesetDrift {
  const actual = ghApi(`"repos/:owner/:repo/rulesets/${id}?includes_parents=false"`);
  if (!actual.ok || typeof actual.data !== 'object' || actual.data === null) {
    return { differences: ['could not read the existing ruleset to compare against'] };
  }

  const current = actual.data as RulesetBody;
  const differences: string[] = [];

  if (current.enforcement !== desired.enforcement) {
    differences.push(
      `enforcement is "${current.enforcement}", standard requires "${desired.enforcement}"`,
    );
  }

  const byType = new Map((current.rules ?? []).map((r) => [r.type, r]));
  for (const rule of desired.rules ?? []) {
    const live = byType.get(rule.type);
    if (!live) {
      differences.push(`rule "${rule.type}" is absent`);
      continue;
    }
    differences.push(...parameterDifferences(live, rule));
  }

  return { differences };
}
