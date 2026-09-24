import { accountEnv, resolveAccount, type CloudflareAccount } from '../lib/cloudflare-account.js';
import { applyMigrations, listDatabases, pendingMigrations, type D1Database } from '../lib/d1.js';
import type { PhaseContext, PhaseResult } from '../lib/phase.js';
import type { ToolRow } from '../lib/ui.js';
import {
  DATABASES,
  databaseId,
  databaseName,
  extractCreatedId,
  readWranglerToml,
  WRANGLER,
  WRANGLER_TOML,
  writeDatabaseIdIfChanged,
  type DatabasePlan,
} from '../lib/wrangler-config.js';

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
 * Each database is checked before anything is done to it: one the file
 * already points at is left alone, one the account already has under the
 * right name is adopted, and only one that exists nowhere is created. That
 * order is what makes a second run, or a run after an interrupted one, safe.
 *
 * It asks before creating, because creating a database is the sort of thing
 * a person should be told is about to happen to their account. It does not
 * ask before reading.
 */
export async function runProvisionPhase(context: PhaseContext): Promise<PhaseResult> {
  const { io } = context;
  const resolved = resolveAccount(io);
  if (!resolved.ok) {
    io.table('Cloudflare resources', [
      { label: 'Cloudflare account', status: 'failed', detail: resolved.problem },
    ]);
    return { success: false };
  }
  const { account } = resolved;

  const databases = listDatabases(io, account);
  if (!databases) {
    io.table('Cloudflare resources', [
      {
        label: 'D1',
        status: 'failed',
        detail: 'could not list databases — is `wrangler login` still valid?',
      },
    ]);
    return { success: false };
  }

  const rows: ToolRow[] = [
    { label: 'Cloudflare account', status: 'ready', detail: `${account.id} (${account.source})` },
  ];
  let success = true;
  let wroteConfig = false;
  for (const plan of DATABASES) {
    // The file is read fresh inside: provisioning the previous database may
    // have rewritten it.
    const outcome = await provisionDatabase({ plan, account, context, rows }, databases);
    if (outcome.wroteConfig) wroteConfig = true;
    if (outcome.status !== 'ready') success = false;
    // Somebody who declines to create a database in this account is answering
    // about the account, not about one database. Asking again for the next one
    // is how a "no" turns into a resource in the wrong place.
    if (outcome.status === 'declined') break;
  }

  io.table('Cloudflare resources', rows);
  if (wroteConfig) io.note(COMMIT_REMINDER, 'Commit the database id');
  return { success };
}

/**
 * Shown whenever this run changed wrangler.toml.
 *
 * The bootstrap deliberately stops at the working tree. Deploys build from
 * the default branch, which only accepts pull requests, so an id that is not
 * merged is an id the deploy workflows never see.
 */
const COMMIT_REMINDER = [
  `This run wrote a database id into ${WRANGLER_TOML}, in this checkout only.`,
  'The deploy workflows read that file from the main branch, so the change',
  'does nothing until it is merged. Commit it on a new branch and open a pull',
  'request. The bootstrap never commits or pushes for you.',
].join('\n');

/** One database's provisioning: what it is, where, and where to report. */
interface DatabaseStep {
  plan: DatabasePlan;
  account: CloudflareAccount;
  context: PhaseContext;
  rows: ToolRow[];
}

interface ProvisionOutcome {
  status: 'ready' | 'failed' | 'declined';
  /** Whether this database's id was written into wrangler.toml. */
  wroteConfig: boolean;
}

/** The first non-blank line, which is where wrangler puts its reason. */
function firstLine(text: string, fallback: string): string {
  return text.split('\n').find((line) => line.trim().length > 0) ?? fallback;
}

/**
 * Creates the database and returns its id, reporting any failure.
 *
 * The id is read from wrangler's output and, when it is not there, from the
 * account by name. Either way the database exists now, so a run that cannot
 * find its id must not end in a state where the next run creates it again.
 */
function createDatabase(
  { plan, account, context, rows }: DatabaseStep,
  name: string,
): string | null {
  const created = context.io.run(`${WRANGLER} d1 create ${name}`, { env: accountEnv(account) });
  if (!created.ok) {
    rows.push({
      label: plan.label,
      status: 'failed',
      detail: firstLine(created.stderr, 'wrangler d1 create failed'),
    });
    return null;
  }

  const id =
    extractCreatedId(`${created.stdout}\n${created.stderr}`) ??
    listDatabases(context.io, account)?.find((database) => database.name === name)?.uuid;
  if (id) return id;

  rows.push({
    label: plan.label,
    status: 'failed',
    detail: `created, but its id could not be read back — re-run \`pnpm bootstrap\`, which finds "${name}" by name`,
  });
  return null;
}

async function confirmCreate(step: DatabaseStep, name: string): Promise<boolean> {
  step.context.io.note(
    [
      `This will create a D1 database called "${name}" in the Cloudflare`,
      `account ${step.account.id}, and write its id into`,
      `${WRANGLER_TOML}. It backs ${step.plan.purpose}.`,
      '',
      'D1 is free at this scale. The id is not a secret — it is committed,',
      'because a deployment that cannot be reproduced from the repository',
      'is not reproducible at all.',
    ].join('\n'),
    'About to create a database',
  );
  return step.context.io.confirm(`Create the D1 database "${name}"?`, true);
}

/**
 * Shown before applying migrations to a database this run did not create.
 *
 * The deploy workflows apply pending migrations before every deploy, so this
 * matters most after an earlier run stopped partway. It asks, because the
 * migrations come from this checkout: run from an unmerged branch, they would
 * reach the database before anybody reviewed them.
 */
function pendingNote(step: DatabaseStep, name: string, names: readonly string[]): string {
  return [
    `"${name}" backs ${step.plan.purpose}. These migrations are in this`,
    'checkout but have not been applied to it:',
    '',
    ...names.map((migration) => `  ${migration}`),
    '',
    'Apply them only from an up-to-date main branch. The deploy workflows',
    'apply them anyway before the next deploy.',
  ].join('\n');
}

/**
 * Brings the database's schema up to this checkout's migrations.
 *
 * Checked on every run, not only after a create: a create whose migrations
 * failed used to leave a database that no later run would ever migrate.
 * Nothing is applied when nothing is pending.
 */
async function migrateDatabase(
  step: DatabaseStep,
  name: string,
  justCreated: boolean,
): Promise<'ready' | 'failed'> {
  const { plan, account, rows } = step;
  const { doctor, io } = step.context;
  const label = `${plan.label} migrations`;

  const pending = pendingMigrations(io, account, plan.environment);
  if (!pending.ok) {
    rows.push({ label, status: 'failed', detail: `could not list them — ${pending.problem}` });
    return 'failed';
  }
  const count = pending.names.length;
  if (count === 0) {
    rows.push({ label, status: 'ready', detail: 'all applied' });
    return 'ready';
  }
  if (doctor) {
    rows.push({
      label,
      status: 'failed',
      detail: `${count} not applied (${pending.names.join(', ')}) — run \`pnpm bootstrap\` to apply them`,
    });
    return 'failed';
  }

  // A database created a moment ago has nothing in it to protect, and the
  // person already agreed to its creation, so it is migrated without asking.
  if (!justCreated) {
    io.note(pendingNote(step, name, pending.names), 'Pending migrations');
    if (!(await io.confirm(`Apply ${count} migration(s) to "${name}" now?`, true))) {
      rows.push({
        label,
        status: 'deferred',
        detail: `${count} not applied — the next deploy applies them`,
      });
      return 'ready';
    }
  }

  // Read back rather than trusting the exit code: wrangler exits cleanly when
  // it decides not to apply anything.
  const applied = applyMigrations(io, account, plan.environment);
  const after = pendingMigrations(io, account, plan.environment);
  if (applied && after.ok && after.names.length === 0) {
    rows.push({ label, status: 'ready', detail: `applied ${count}` });
    return 'ready';
  }
  rows.push({
    label,
    status: 'failed',
    detail: 'did not all apply — re-run `pnpm bootstrap` to retry the rest',
  });
  return 'failed';
}

async function provisionDatabase(
  step: DatabaseStep,
  databases: readonly D1Database[],
): Promise<ProvisionOutcome> {
  const { plan, rows } = step;
  const { doctor, io } = step.context;
  const toml = readWranglerToml(io);
  const name = databaseName(toml, plan.environment);

  if (!name) {
    rows.push({
      label: plan.label,
      status: 'failed',
      detail: `no database_name found — the ${plan.environment} [[d1_databases]] block is missing or malformed`,
    });
    return { status: 'failed', wroteConfig: false };
  }

  // The id in the file is authoritative only if the account can actually see
  // it. An id belonging to someone else's account reads as configured and
  // fails at deploy.
  const configured = databaseId(toml, plan.environment);
  if (configured && databases.some((database) => database.uuid === configured)) {
    rows.push({ label: plan.label, status: 'ready', detail: `${name} (${configured})` });
    return { status: await migrateDatabase(step, name, false), wroteConfig: false };
  }

  // The account already has a database with this name, and the file does not
  // point at it: an earlier run created it and stopped before the id was
  // written, or the file came from another account. Names are unique within
  // an account, so creating it again can only fail. Adopting it is the resume.
  const existing = databases.find((database) => database.name === name);
  if (existing) {
    if (doctor) {
      rows.push({
        label: plan.label,
        status: 'failed',
        detail: `"${name}" exists (${existing.uuid}), but ${WRANGLER_TOML} does not point at it — run \`pnpm bootstrap\` to write its id`,
      });
      return { status: 'failed', wroteConfig: false };
    }
    const wroteConfig = writeDatabaseIdIfChanged(io, toml, plan.environment, existing.uuid);
    rows.push({
      label: plan.label,
      status: 'ready',
      detail: `${name} (${existing.uuid}) — already in the account; id written to ${WRANGLER_TOML}`,
    });
    return { status: await migrateDatabase(step, name, false), wroteConfig };
  }

  if (doctor) {
    rows.push({
      label: plan.label,
      status: 'failed',
      detail: configured
        ? `id in ${WRANGLER_TOML} is not visible to this account, and no database is named "${name}" — run \`pnpm bootstrap\` to create it`
        : `"${name}" does not exist yet — run \`pnpm bootstrap\` to create it`,
    });
    return { status: 'failed', wroteConfig: false };
  }

  if (!(await confirmCreate(step, name))) {
    rows.push({ label: plan.label, status: 'skipped', detail: 'declined — nothing was created' });
    return { status: 'declined', wroteConfig: false };
  }

  const createdId = createDatabase(step, name);
  if (!createdId) return { status: 'failed', wroteConfig: false };

  const wroteConfig = writeDatabaseIdIfChanged(io, toml, plan.environment, createdId);
  rows.push({ label: plan.label, status: 'ready', detail: `${name} (${createdId}) — created` });
  return { status: await migrateDatabase(step, name, true), wroteConfig };
}
