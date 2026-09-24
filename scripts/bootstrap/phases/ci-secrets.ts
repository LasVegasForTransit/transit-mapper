import type { BootstrapIo } from '../lib/io.js';
import type { PhaseContext, PhaseResult } from '../lib/phase.js';
import type { ToolRow } from '../lib/ui.js';
import { ACCOUNT_VARIABLE, parseJsonOutput, resolveAccount } from '../lib/cloudflare-account.js';
import { REQUIRED_ENVIRONMENTS } from '../standards.js';

/**
 * Account-scoped API token page: tokens created here are bound to a single
 * Cloudflare account from the start, unlike the user-scoped
 * `/profile/api-tokens` page which can roam across every account the user
 * is a member of.
 */
function tokenDashboardUrl(accountId: string): string {
  return `https://dash.cloudflare.com/${accountId}/api-tokens`;
}

/**
 * Step-by-step instructions shown before the token prompt. This is the part
 * that makes the prompt usable by someone who has never created a Cloudflare
 * API token before — a bare "paste your token" prompt with no context is not
 * "standardized bootstrap tooling," it's a trap for anyone who isn't already
 * a Cloudflare/Workers expert.
 */
function tokenPromptBody(accountId: string): string {
  return [
    'This lets GitHub Actions deploy the Worker on every push to main.',
    '',
    `  1. Open ${tokenDashboardUrl(accountId)} (opening it for you now)`,
    '  2. Find "Edit Cloudflare Workers" and click "Use template"',
    '     This creates TWO permission blocks — one scoped to "Account"',
    '     (Workers Scripts, KV, R2), one scoped to "Specified Domains"',
    '     (Workers Routes). Leave both as they are.',
    '  3. Click "+ Add policy" to add a THIRD block (D1 is account-scoped,',
    "     so it can't go in either existing block):",
    '       - Change its left dropdown from "Specified Domains" to "Account"',
    '       - Search "database" and check Edit next to "D1 Database"',
    '       - Set the account selector to this account',
    '  4. On each Account-scoped block, confirm the account selected is',
    '     this one (not "All accounts")',
    '  5. Click "Continue to summary", then "Create Token"',
    '  6. Copy the token from the success screen',
    '  7. Paste it below (it will not be shown on screen as you type)',
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
  accountId: string,
  environments: string[],
): Promise<boolean> {
  // Prompted once even when several environments need it. Asking twice for
  // the same token invites two different tokens, and then one environment
  // deploys with credentials nobody knows about.
  io.note(tokenPromptBody(accountId), 'Cloudflare API token');
  io.openUrl(tokenDashboardUrl(accountId));
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

  if (plan.token.length > 0 && !(await writeToken(io, accountId, plan.token))) {
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
