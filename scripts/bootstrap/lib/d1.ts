import { accountEnv, parseJsonOutput, type CloudflareAccount } from './cloudflare-account.js';
import type { BootstrapIo } from './io.js';
import { WRANGLER } from './wrangler-config.js';

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
