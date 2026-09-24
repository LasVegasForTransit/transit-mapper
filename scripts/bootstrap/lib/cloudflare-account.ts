import type { BootstrapIo } from './io.js';
import { REQUIRED_ENVIRONMENTS } from '../standards.js';
import { declaredAccountId, readWranglerToml, WRANGLER, WRANGLER_TOML } from './wrangler-config.js';

/** The GitHub environment variable the deploy workflows read the account from. */
export const ACCOUNT_VARIABLE = 'CLOUDFLARE_ACCOUNT_ID';

export interface CloudflareAccount {
  id: string;
  /** The account's name as the dashboard shows it, for steps that pick it. */
  name: string;
  /** Where the id came from, in words a reader can go and check. */
  source: string;
}

export type AccountResolution =
  { ok: true; account: CloudflareAccount } | { ok: false; problem: string };

interface WhoamiOutput {
  accounts?: { id?: unknown; name?: unknown }[];
}

interface VisibleAccount {
  id: string;
  name: string;
}

/** JSON out of a command's stdout, or null. Whatever wrangler prints before
 *  the document (a banner, a warning) is skipped rather than fatal. */
export function parseJsonOutput(stdout: string): unknown {
  const start = stdout.search(/[[{]/u);
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start)) as unknown;
  } catch {
    return null;
  }
}

/** The accounts the logged-in wrangler user can act on, or null when
 *  wrangler cannot say (not logged in, or no network). */
function visibleAccounts(io: BootstrapIo): VisibleAccount[] | null {
  const result = io.run(`${WRANGLER} whoami --json`);
  if (!result.ok) return null;
  const parsed = parseJsonOutput(result.stdout) as WhoamiOutput | null;
  if (!parsed || !Array.isArray(parsed.accounts)) return null;
  return parsed.accounts.flatMap((account) =>
    typeof account.id === 'string'
      ? [{ id: account.id, name: typeof account.name === 'string' ? account.name : account.id }]
      : [],
  );
}

/**
 * The CLOUDFLARE_ACCOUNT_ID the GitHub environments already hold, when every
 * environment that holds one agrees. A read that fails counts as holding
 * nothing: on a first run the environments do not exist yet.
 */
function accountFromVariables(io: BootstrapIo): string | null {
  const values = new Set<string>();
  for (const environment of REQUIRED_ENVIRONMENTS) {
    const listed = io.run(`gh variable list --env ${environment} --json name,value`);
    if (!listed.ok) continue;
    const rows = parseJsonOutput(listed.stdout);
    if (!Array.isArray(rows)) continue;
    for (const row of rows as { name?: unknown; value?: unknown }[]) {
      if (row.name === ACCOUNT_VARIABLE && typeof row.value === 'string') values.add(row.value);
    }
  }
  return values.size === 1 ? ([...values][0] ?? null) : null;
}

/**
 * The one Cloudflare account this run acts on.
 *
 * In order: `account_id` in wrangler.toml, the CLOUDFLARE_ACCOUNT_ID the
 * GitHub environments already hold, and the login's only account. Never the
 * login's first account: which account wrangler lists first is not a
 * decision anybody made, and taking it is how a second run points CI at a
 * different account from the one the first run provisioned.
 */
export function resolveAccount(io: BootstrapIo): AccountResolution {
  const visible = visibleAccounts(io);
  if (!visible) {
    return {
      ok: false,
      problem: 'wrangler could not list the accounts this login can use — log in again',
    };
  }

  const declared = declaredAccountId(readWranglerToml(io));
  const fromVariables = declared ? null : accountFromVariables(io);
  const only = visible.length === 1 ? visible[0]?.id : undefined;
  const chosen = declared
    ? { id: declared, source: `account_id in ${WRANGLER_TOML}` }
    : fromVariables
      ? { id: fromVariables, source: `the ${ACCOUNT_VARIABLE} variable in GitHub` }
      : only
        ? { id: only, source: 'the only account this login can use' }
        : null;

  if (!chosen) {
    return {
      ok: false,
      problem: `this login can use ${visible.length} accounts; add account_id = "<id>" to ${WRANGLER_TOML} to choose one`,
    };
  }
  const member = visible.find((account) => account.id === chosen.id);
  if (!member) {
    return {
      ok: false,
      problem: `this wrangler login cannot use account ${chosen.id} (${chosen.source}) — log in as a member of it`,
    };
  }
  return { ok: true, account: { ...chosen, name: member.name } };
}

/**
 * Environment for a wrangler command, pinning it to `account`.
 *
 * Wrangler would read `account_id` from wrangler.toml by itself, but a fork
 * without one falls back to CLOUDFLARE_ACCOUNT_ID and then to a cached pick
 * from an earlier session. Passing it keeps every command on the account this
 * run resolved.
 */
export function accountEnv(account: CloudflareAccount): Record<string, string> {
  return { [ACCOUNT_VARIABLE]: account.id };
}
