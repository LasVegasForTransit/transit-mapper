import { accountEnv, parseJsonOutput, type CloudflareAccount } from './cloudflare-account.js';
import type { BootstrapIo } from './io.js';
import { WRANGLER, type WranglerEnvironment } from './wrangler-config.js';

/** A D1 database as `wrangler d1 list --json` reports it. */
export interface D1Database {
  uuid: string;
  name: string;
}

/**
 * Every D1 database in `account`, or null when wrangler could not list them.
 *
 * JSON rather than the table: matching an id against the table's text also
 * matches it inside another column, and the table has no stable shape to
 * parse a name out of.
 */
export function listDatabases(io: BootstrapIo, account: CloudflareAccount): D1Database[] | null {
  const listed = io.run(`${WRANGLER} d1 list --json`, { env: accountEnv(account) });
  if (!listed.ok) return null;
  const parsed = parseJsonOutput(listed.stdout);
  if (!Array.isArray(parsed)) return null;
  return (parsed as { uuid?: unknown; name?: unknown }[]).flatMap((entry) =>
    typeof entry.uuid === 'string' && typeof entry.name === 'string'
      ? [{ uuid: entry.uuid, name: entry.name }]
      : [],
  );
}

/**
 * The `--env` flag for one deployment. Wrangler resolves the `DB` binding out
 * of the configuration for the environment it is given, and the preview
 * database is not in the production one.
 */
function environmentFlag(environment: WranglerEnvironment): string {
  return environment === 'production' ? '' : ` --env ${environment}`;
}

export type PendingMigrations = { ok: true; names: string[] } | { ok: false; problem: string };

/**
 * Migration files in this checkout that the environment's database has not
 * recorded as applied.
 *
 * Asked of wrangler rather than worked out here, because wrangler's own
 * `d1_migrations` table is the record `migrations apply` consults. It prints
 * "No migrations to apply" or a table of file names; anything else is
 * reported as unreadable rather than guessed at.
 */
export function pendingMigrations(
  io: BootstrapIo,
  account: CloudflareAccount,
  environment: WranglerEnvironment,
): PendingMigrations {
  const listed = io.run(
    `${WRANGLER} d1 migrations list DB --remote${environmentFlag(environment)}`,
    { env: accountEnv(account) },
  );
  if (!listed.ok) {
    return {
      ok: false,
      problem: listed.stderr.split('\n').find((line) => line.trim()) ?? 'wrangler failed',
    };
  }
  if (listed.stdout.includes('No migrations to apply')) return { ok: true, names: [] };
  const marker = listed.stdout.indexOf('Migrations to be applied');
  const names =
    marker < 0 ? [] : [...listed.stdout.slice(marker).matchAll(/[\w.-]+\.sql/gu)].map((m) => m[0]);
  return names.length > 0
    ? { ok: true, names }
    : { ok: false, problem: 'wrangler printed a migration list this script does not recognise' };
}

/** Applies every pending migration to the environment's database. */
export function applyMigrations(
  io: BootstrapIo,
  account: CloudflareAccount,
  environment: WranglerEnvironment,
): boolean {
  return io.run(`${WRANGLER} d1 migrations apply DB --remote${environmentFlag(environment)}`, {
    env: accountEnv(account),
  }).ok;
}
