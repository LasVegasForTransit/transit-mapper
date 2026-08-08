import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { note } from '@clack/prompts';
import { runCommand } from '../lib/shell.js';
import { printToolTable, promptConfirm, type ToolRow } from '../lib/ui.js';
import type { PhaseResult } from './auth.js';

const WORKER_DIR = path.join('apps', 'worker');
const WRANGLER_TOML = path.join(WORKER_DIR, 'wrangler.toml');
const PLACEHOLDER_DB_ID = '00000000-0000-0000-0000-000000000000';

/** The database name in wrangler.toml. Read rather than assumed, so renaming
 *  it there does not silently provision something else. */
function databaseName(toml: string): string | null {
  return /database_name\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? null;
}

function databaseId(toml: string): string | null {
  const id = /database_id\s*=\s*"([^"]+)"/.exec(toml)?.[1];
  return !id || id === PLACEHOLDER_DB_ID ? null : id;
}

/** `wrangler d1 create` prints the new binding block; the id is in it. */
function extractCreatedId(output: string): string | null {
  return /database_id\s*=\s*"?([0-9a-f-]{36})"?/i.exec(output)?.[1] ?? null;
}

/**
 * Creates what the deployment needs and writes the result back into
 * `wrangler.toml`, rather than telling the reader to run commands and paste
 * ids themselves.
 *
 * This is the phase that makes a fresh Cloudflare account deployable at all.
 * Before it existed, `database_id` was a hardcoded value belonging to one
 * account: cloning the repository and running the deploy produced an error
 * about a database that was never going to exist, and the only record of how
 * to create it lived inside a design document.
 *
 * It asks before creating, because creating a database is the sort of thing
 * a person should be told is about to happen to their account. It does not
 * ask before reading.
 */
export async function runProvisionPhase(options: { doctor: boolean }): Promise<PhaseResult> {
  const rows: ToolRow[] = [];
  const toml = readFileSync(WRANGLER_TOML, 'utf8');
  const name = databaseName(toml);

  if (!name) {
    printToolTable('Cloudflare resources', [
      {
        label: 'wrangler.toml',
        status: 'failed',
        detail: 'no database_name found — the [[d1_databases]] block is missing or malformed',
      },
    ]);
    return { success: false };
  }

  const existingId = databaseId(toml);
  const list = runCommand(`cd ${WORKER_DIR} && wrangler d1 list`);

  if (!list.ok) {
    printToolTable('Cloudflare resources', [
      {
        label: 'D1',
        status: 'failed',
        detail: 'could not list databases — is `wrangler login` still valid?',
      },
    ]);
    return { success: false };
  }

  // The id in the file is authoritative only if the account can actually see
  // it. An id belonging to someone else's account reads as configured and
  // fails at deploy.
  if (existingId && list.stdout.includes(existingId)) {
    rows.push({ label: 'D1 database', status: 'ready', detail: `${name} (${existingId})` });
    printToolTable('Cloudflare resources', rows);
    return { success: true };
  }

  if (options.doctor) {
    printToolTable('Cloudflare resources', [
      {
        label: 'D1 database',
        status: 'failed',
        detail: existingId
          ? `id in wrangler.toml is not visible to this account — run \`pnpm bootstrap\` to provision`
          : `"${name}" does not exist yet — run \`pnpm bootstrap\` to create it`,
      },
    ]);
    return { success: false };
  }

  note(
    [
      `This will create a D1 database called "${name}" in the Cloudflare`,
      'account you are currently logged into, and write its id into',
      `${WRANGLER_TOML}.`,
      '',
      'D1 is free at this scale. The id is not a secret — it is committed,',
      'because a deployment that cannot be reproduced from the repository',
      'is not reproducible at all.',
    ].join('\n'),
    'About to create a database',
  );

  const confirmed = await promptConfirm(`Create the D1 database "${name}"?`, true);
  if (!confirmed) {
    printToolTable('Cloudflare resources', [
      { label: 'D1 database', status: 'skipped', detail: 'declined — nothing was created' },
    ]);
    return { success: false };
  }

  const created = runCommand(`cd ${WORKER_DIR} && wrangler d1 create ${name}`);
  if (!created.ok) {
    printToolTable('Cloudflare resources', [
      {
        label: 'D1 database',
        status: 'failed',
        // First non-blank line, not first line: wrangler sometimes leads with an
        // empty one, and `??` would happily report that as the reason.
        detail:
          created.stderr.split('\n').find((line) => line.trim().length > 0) ??
          'wrangler d1 create failed',
      },
    ]);
    return { success: false };
  }

  const newId = extractCreatedId(`${created.stdout}\n${created.stderr}`);
  if (!newId) {
    printToolTable('Cloudflare resources', [
      {
        label: 'D1 database',
        status: 'failed',
        detail: 'created, but no database_id could be read back from wrangler output',
      },
    ]);
    return { success: false };
  }

  // Replace only the id, leaving every comment in the file intact.
  writeFileSync(
    WRANGLER_TOML,
    toml.replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${newId}"`),
    'utf8',
  );
  rows.push({ label: 'D1 database', status: 'ready', detail: `${name} (${newId}) — created` });

  const migrated = runCommand(`cd ${WORKER_DIR} && wrangler d1 migrations apply ${name} --remote`);
  rows.push(
    migrated.ok
      ? { label: 'Migrations', status: 'ready', detail: 'applied to the new database' }
      : {
          label: 'Migrations',
          status: 'failed',
          detail: 'database created, but migrations did not apply — re-run `pnpm bootstrap`',
        },
  );

  printToolTable('Cloudflare resources', rows);
  return { success: migrated.ok };
}
