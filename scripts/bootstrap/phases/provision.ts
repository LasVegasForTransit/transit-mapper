import { note } from '@clack/prompts';
import { runCommand } from '../lib/shell.js';
import { printToolTable, promptConfirm, type ToolRow } from '../lib/ui.js';
import {
  DATABASES,
  databaseId,
  databaseName,
  extractCreatedId,
  readWranglerToml,
  WORKER_DIR,
  WRANGLER_TOML,
  writeDatabaseId,
  type DatabasePlan,
} from '../lib/wrangler-config.js';
import type { PhaseResult } from './auth.js';

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

  let success = true;
  for (const plan of DATABASES) {
    // Read fresh each time: provisioning the previous database rewrote the file.
    const outcome = await provisionDatabase(plan, list.stdout, options, rows);
    if (outcome !== 'ready') success = false;
    // Somebody who declines to create a database in this account is answering
    // about the account, not about one database. Asking again for the next one
    // is how a "no" turns into a resource in the wrong place.
    if (outcome === 'declined') break;
  }

  printToolTable('Cloudflare resources', rows);
  return { success };
}

/** Creates the database and reads its id back, reporting either failure. */
function createDatabase(name: string, label: string, rows: ToolRow[]): string | null {
  const created = runCommand(`cd ${WORKER_DIR} && wrangler d1 create ${name}`);
  if (!created.ok) {
    rows.push({
      label,
      status: 'failed',
      // First non-blank line, not first line: wrangler sometimes leads with an
      // empty one, and `??` would happily report that as the reason.
      detail:
        created.stderr.split('\n').find((line) => line.trim().length > 0) ??
        'wrangler d1 create failed',
    });
    return null;
  }

  const newId = extractCreatedId(`${created.stdout}\n${created.stderr}`);
  if (!newId) {
    rows.push({
      label,
      status: 'failed',
      detail: 'created, but no database_id could be read back from wrangler output',
    });
    return null;
  }
  return newId;
}

type ProvisionOutcome = 'ready' | 'failed' | 'declined';

async function provisionDatabase(
  plan: DatabasePlan,
  existingDatabases: string,
  options: { doctor: boolean },
  rows: ToolRow[],
): Promise<ProvisionOutcome> {
  const toml = readWranglerToml();
  const name = databaseName(toml, plan.environment);

  if (!name) {
    rows.push({
      label: plan.label,
      status: 'failed',
      detail: `no database_name found — the ${plan.environment} [[d1_databases]] block is missing or malformed`,
    });
    return 'failed';
  }

  const existingId = databaseId(toml, plan.environment);

  // The id in the file is authoritative only if the account can actually see
  // it. An id belonging to someone else's account reads as configured and
  // fails at deploy.
  if (existingId && existingDatabases.includes(existingId)) {
    rows.push({ label: plan.label, status: 'ready', detail: `${name} (${existingId})` });
    return 'ready';
  }

  if (options.doctor) {
    rows.push({
      label: plan.label,
      status: 'failed',
      detail: existingId
        ? 'id in wrangler.toml is not visible to this account — run `pnpm bootstrap` to provision'
        : `"${name}" does not exist yet — run \`pnpm bootstrap\` to create it`,
    });
    return 'failed';
  }

  note(
    [
      `This will create a D1 database called "${name}" in the Cloudflare`,
      'account you are currently logged into, and write its id into',
      `${WRANGLER_TOML}. It backs ${plan.purpose}.`,
      '',
      'D1 is free at this scale. The id is not a secret — it is committed,',
      'because a deployment that cannot be reproduced from the repository',
      'is not reproducible at all.',
    ].join('\n'),
    'About to create a database',
  );

  const confirmed = await promptConfirm(`Create the D1 database "${name}"?`, true);
  if (!confirmed) {
    rows.push({ label: plan.label, status: 'skipped', detail: 'declined — nothing was created' });
    return 'declined';
  }

  const newId = createDatabase(name, plan.label, rows);
  if (!newId) return 'failed';

  writeDatabaseId(toml, plan.environment, newId);
  rows.push({ label: plan.label, status: 'ready', detail: `${name} (${newId}) — created` });

  // Addressed by binding rather than by name, and with the environment named:
  // wrangler resolves a database out of the configuration for the environment
  // it was given, and the preview database is not in the production one.
  const scope = plan.environment === 'production' ? '' : ` --env ${plan.environment}`;
  const migrated = runCommand(
    `cd ${WORKER_DIR} && wrangler d1 migrations apply DB --remote${scope}`,
  );
  rows.push(
    migrated.ok
      ? {
          label: `${plan.label} migrations`,
          status: 'ready',
          detail: 'applied to the new database',
        }
      : {
          label: `${plan.label} migrations`,
          status: 'failed',
          detail: 'database created, but migrations did not apply — re-run `pnpm bootstrap`',
        },
  );

  return migrated.ok ? 'ready' : 'failed';
}
