import type { BootstrapIo } from '../lib/io.js';
import type { PhaseContext, PhaseResult } from '../lib/phase.js';
import type { ToolRow } from '../lib/ui.js';
import {
  ACCOUNT_VARIABLE,
  parseJsonOutput,
  resolveAccount,
  type CloudflareAccount,
} from '../lib/cloudflare-account.js';
import { deployTarget, readWranglerToml, type DeployTarget } from '../lib/wrangler-config.js';
import { REQUIRED_ENVIRONMENTS } from '../standards.js';

/**
 * The account's own API token page (Manage Account → Account API Tokens).
 *
 * An account-owned token, not one from a person's profile: it belongs to the
 * LVBT account, so deploys keep working when the person who made it leaves
 * or loses access. Cloudflare lists Workers, D1 and R2 as compatible with
 * account-owned tokens, and its Workers CI/CD guide creates the deploy token
 * on this page. Such a token cannot hold User permissions, which Wrangler
 * does not need here: every workflow sets CLOUDFLARE_ACCOUNT_ID, and Wrangler
 * reads that before it would look up the user's memberships.
 */
function tokenDashboardUrl(account: CloudflareAccount): string {
  return `https://dash.cloudflare.com/${account.id}/api-tokens`;
}

/**
 * The account and zone permissions the "Edit Cloudflare Workers" template
 * fills in, in the dashboard's words. Listed so the reader can check the
 * screen before adding anything, instead of wondering whether one is missing.
 */
const TEMPLATE_PERMISSIONS = [
  'Account · Workers Scripts · Edit',
  'Account · Workers KV Storage · Edit',
  'Account · Workers R2 Storage · Edit   (the daily GTFS refresh needs it)',
  'Account · Workers Tail · Read',
  'Account · Account Settings · Read',
  'Zone · Workers Routes · Edit',
];

/**
 * Step-by-step instructions shown before the token prompt, for somebody who
 * has never made a Cloudflare API token: every name to type, every
 * permission to add, and every option to pick, so nothing is guessed.
 *
 * The one permission the template lacks is D1: the production and preview
 * workflows both apply D1 migrations before they deploy. R2 is already in
 * the template, which is why it is listed rather than added.
 *
 * Every copied value is pasted before anything else is copied: the prompt is
 * already waiting when the token is shown, and the bootstrap itself writes
 * it to both environments, so nobody holds one value while fetching another.
 */
function tokenPromptBody(account: CloudflareAccount, target: DeployTarget): string {
  const site = target.host ?? 'TransitMapper';
  const zones = target.zones.length > 0 ? target.zones.join(', ') : 'the zone of your routes';
  return [
    'This token lets GitHub Actions deploy TransitMapper. You make it once;',
    'the bootstrap stores it and does not ask for it again.',
    '',
    'It is an account-owned token: it belongs to the LVBT account, not to',
    'you. Cloudflare lets only a Super Administrator of the account make one.',
    '',
    `  1. Open ${tokenDashboardUrl(account)}`,
    '     (opening it for you now). In the dashboard this is',
    '     Manage Account → Account API Tokens.',
    '  2. Click "Create Token".',
    '  3. Under "Permission policies", open the "Custom" dropdown and',
    '     choose "Edit Cloudflare Workers".',
    `  4. Token name: ${site} deploy (GitHub Actions)`,
    '  5. Keep every permission the template fills in. They include:',
    ...TEMPLATE_PERMISSIONS.map((permission) => `       ${permission}`),
    '     Add one more, because every deploy applies D1 migrations:',
    '       Account · D1 · Edit',
    `  6. Zone Resources: Include → Specific zone → ${zones}`,
    '  7. Leave the expiration date empty, so deploys keep working.',
    '  8. Click "Continue to summary", then "Create Token".',
    '  9. Copy the token. Cloudflare shows it only once.',
    ' 10. Paste it below. It is not shown on screen as you type.',
    '',
    'The token is a secret. The bootstrap stores it only as the',
    `${TOKEN_SECRET} environment secret on the ${REQUIRED_ENVIRONMENTS.join(' and ')}`,
    'GitHub environments.',
    '',
    `${ACCOUNT_VARIABLE} is set for you to ${account.id},`,
    `from ${account.source}.`,
    'It is not a secret, and there is nothing to copy for it.',
    '',
    'If this token is ever rolled or deleted in Cloudflare, the stored copy',
    'stops working. Make a new one the same way and store it with',
    '`pnpm bootstrap --rotate-token`.',
  ].join('\n');
}

const TOKEN_SECRET = 'CLOUDFLARE_API_TOKEN';

/** What one GitHub environment holds now. Values of secrets are unreadable
 *  by design, so the token is only ever known to be present or absent. */
export interface CiEnvironmentState {
  environment: string;
  tokenSet: boolean;
  /** The CLOUDFLARE_ACCOUNT_ID variable's value, or null when it is unset. */
  accountVariable: string | null;
}

/** Values the person asked, by flag, to replace even though they are set. */
export interface CiReplaceFlags {
  rotateToken: boolean;
  replaceAccountId: boolean;
}

/** An account variable that holds a different account and was left alone. */
export interface AccountConflict {
  environment: string;
  current: string;
}

export interface CiWritePlan {
  /** Environments whose token secret this run writes. */
  token: string[];
  /** Environments whose account variable this run writes. */
  account: string[];
  conflicts: AccountConflict[];
}

/**
 * Decides what to write, and nothing else.
 *
 * A set value is never written again without the flag that asks for it. A
 * token cannot be read back, so "set" is the only evidence available, and
 * asking for it again on every run is how a second token gets minted and the
 * first is left live somewhere. An account variable holding a different
 * account is reported, not corrected: either one could be the mistake, and
 * the bootstrap is in no position to say which.
 */
export function planCiWrites(
  states: readonly CiEnvironmentState[],
  accountId: string,
  flags: CiReplaceFlags,
): CiWritePlan {
  const differs = states.filter(
    (state) => state.accountVariable !== null && state.accountVariable !== accountId,
  );
  return {
    token: states
      .filter((state) => flags.rotateToken || !state.tokenSet)
      .map((state) => state.environment),
    account: states
      .filter(
        (state) =>
          state.accountVariable === null || (flags.replaceAccountId && differs.includes(state)),
      )
      .map((state) => state.environment),
    conflicts: flags.replaceAccountId
      ? []
      : differs.map((state) => ({
          environment: state.environment,
          current: state.accountVariable ?? '',
        })),
  };
}

function readCiEnvironment(io: BootstrapIo, environment: string): CiEnvironmentState | null {
  const secrets = io.run(`gh secret list --env ${environment} --json name`);
  const variables = io.run(`gh variable list --env ${environment} --json name,value`);
  if (!secrets.ok || !variables.ok) return null;
  const secretRows = parseJsonOutput(secrets.stdout);
  const variableRows = parseJsonOutput(variables.stdout);
  if (!Array.isArray(secretRows) || !Array.isArray(variableRows)) return null;
  const account = (variableRows as { name?: unknown; value?: unknown }[]).find(
    (row) => row.name === ACCOUNT_VARIABLE,
  );
  return {
    environment,
    tokenSet: (secretRows as { name?: unknown }[]).some((row) => row.name === TOKEN_SECRET),
    accountVariable: typeof account?.value === 'string' ? account.value : null,
  };
}

function readCiEnvironments(io: BootstrapIo): CiEnvironmentState[] | null {
  const states: CiEnvironmentState[] = [];
  for (const environment of REQUIRED_ENVIRONMENTS) {
    const state = readCiEnvironment(io, environment);
    if (!state) {
      io.log('error', `Could not read the "${environment}" GitHub Environment credentials.`);
      return null;
    }
    states.push(state);
  }
  return states;
}

function tokenRow(state: CiEnvironmentState, plan: CiWritePlan): ToolRow {
  const label = `${TOKEN_SECRET} (${state.environment})`;
  if (!plan.token.includes(state.environment)) return { label, status: 'ready', detail: 'set' };
  return state.tokenSet
    ? { label, status: 'deferred', detail: 'set — will be replaced, as --rotate-token asks' }
    : { label, status: 'failed', detail: 'not set' };
}

function accountRow(state: CiEnvironmentState, accountId: string, plan: CiWritePlan): ToolRow {
  const label = `${ACCOUNT_VARIABLE} (${state.environment})`;
  if (state.accountVariable === accountId) return { label, status: 'ready', detail: accountId };
  if (state.accountVariable === null) return { label, status: 'failed', detail: 'not set' };
  return plan.account.includes(state.environment)
    ? {
        label,
        status: 'deferred',
        detail: `${state.accountVariable} — will be replaced with ${accountId}, as --replace-account-id asks`,
      }
    : {
        label,
        status: 'failed',
        detail: `holds ${state.accountVariable}, not ${accountId} — left alone; re-run with --replace-account-id to overwrite it`,
      };
}

/** One credential to write to several GitHub environments. */
interface EnvironmentWrite {
  kind: 'secret' | 'variable';
  name: string;
  value: string;
  environments: readonly string[];
}

/**
 * Runs one `gh secret set` or `gh variable set` per environment, stopping at
 * the first refusal.
 *
 * The value goes in on standard input, which both commands read when no
 * `--body` is given. On the command line a token would sit in the process
 * table for as long as `gh` runs and in the transcript of any tool that
 * logged the command, which is what docs/security/reference/secrets.md
 * forbids.
 */
function setOnEnvironments(io: BootstrapIo, write: EnvironmentWrite): boolean {
  for (const environment of write.environments) {
    const result = io.run(`gh ${write.kind} set ${write.name} --env ${environment}`, {
      input: write.value,
    });
    if (!result.ok) {
      io.log(
        'error',
        `Failed to set ${write.name} on "${environment}": ${result.stderr || result.stdout}`,
      );
      return false;
    }
  }
  return true;
}

/** Prompts once for the token and writes it to every environment in the plan. */
async function writeToken(
  io: BootstrapIo,
  account: CloudflareAccount,
  environments: string[],
): Promise<boolean> {
  // Prompted once even when several environments need it. Asking twice for
  // the same token invites two different tokens, and then one environment
  // deploys with credentials nobody knows about.
  io.note(tokenPromptBody(account, deployTarget(readWranglerToml(io))), 'Cloudflare API token');
  io.openUrl(tokenDashboardUrl(account));
  const token = await io.secret('Paste the Cloudflare API token:');
  const written = setOnEnvironments(io, {
    kind: 'secret',
    name: TOKEN_SECRET,
    value: token,
    environments,
  });
  if (!written) {
    io.log(
      'info',
      'If an environment does not exist yet, run `pnpm bootstrap` — the repository governance phase creates it.',
    );
  }
  return written;
}

/**
 * Makes sure every GitHub Environment the deployment workflows use (see
 * REQUIRED_ENVIRONMENTS) holds a CLOUDFLARE_API_TOKEN secret and a
 * CLOUDFLARE_ACCOUNT_ID variable naming the declared account, and writes
 * only what is missing. The token is passed straight to `gh secret set` on
 * standard input and never touches a command line, the general subprocess
 * environment (see the denylist in lib/shell.ts), or any on-disk file.
 *
 * The same token for every environment, because Cloudflare has no per-script
 * token scope: any token that can deploy a preview Worker can also overwrite
 * the production one. Separate environments buy separate deployment records
 * and somewhere to put a narrower token the day one exists — not isolation.
 */
export async function runCiSecretsPhase({
  doctor,
  io,
  rotateToken,
  replaceAccountId,
}: PhaseContext): Promise<PhaseResult> {
  const resolved = resolveAccount(io);
  if (!resolved.ok) {
    io.table('CI secrets', [
      { label: 'Cloudflare account', status: 'failed', detail: resolved.problem },
    ]);
    return { success: false };
  }
  const accountId = resolved.account.id;

  const states = readCiEnvironments(io);
  if (!states) return { success: false };

  const plan = planCiWrites(states, accountId, { rotateToken, replaceAccountId });
  io.table(
    'CI secrets',
    states.flatMap((state) => [tokenRow(state, plan), accountRow(state, accountId, plan)]),
  );

  const noConflicts = plan.conflicts.length === 0;
  if (plan.token.length === 0 && plan.account.length === 0) return { success: noConflicts };

  // Doctor mode reports and returns. Prompting would make `pnpm preflight`
  // interactive, which defeats running it in a script or a fresh shell to
  // find out what is wrong.
  if (doctor) return { success: false };

  const targets = [...new Set([...plan.token, ...plan.account])];
  const proceed = await io.confirm(
    `Write the CI credentials listed above to the ${targets.map((name) => `"${name}"`).join(' and ')} GitHub Environments now?`,
    true,
  );
  if (!proceed) return { success: false };

  if (plan.token.length > 0 && !(await writeToken(io, resolved.account, plan.token))) {
    return { success: false };
  }

  const wroteAccountId = setOnEnvironments(io, {
    kind: 'variable',
    name: ACCOUNT_VARIABLE,
    value: accountId,
    environments: plan.account,
  });
  if (!wroteAccountId) return { success: false };

  if (!noConflicts) {
    io.log(
      'error',
      `${ACCOUNT_VARIABLE} names a different account on ${plan.conflicts.map((c) => c.environment).join(' and ')}. Nothing was overwritten. If ${accountId} (${resolved.account.source}) is right, re-run with --replace-account-id.`,
    );
    return { success: false };
  }

  io.log(
    'success',
    `${TOKEN_SECRET} (secret) and ${ACCOUNT_VARIABLE} (variable) are set on ${states.map((state) => state.environment).join(' and ')}. CI deploys should work on the next push to main.`,
  );
  return { success: true };
}
