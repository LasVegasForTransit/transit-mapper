import { log, note } from '@clack/prompts';
import { runCommand, shellEscape, tryOpenInBrowser } from '../lib/shell.js';
import { printToolTable, promptConfirm, promptSecret } from '../lib/ui.js';
import { REQUIRED_ENVIRONMENTS } from '../standards.js';
import type { PhaseResult } from './auth.js';

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

/**
 * Extract `{ name, id }` pairs from a `wrangler whoami` table. Anchors on
 * the box-drawing pipe (`│`) plus a 32-character lowercase hex account id,
 * since wrangler's table format is the stable part of its output, not the
 * surrounding prose.
 */
function parseAccountIds(stdout: string): string[] {
  const rowRe = /│\s*([^│]+?)\s*│\s*([0-9a-f]{32})\s*│/g;
  const ids: string[] = [];
  for (const line of stdout.split('\n')) {
    rowRe.lastIndex = 0;
    const match = rowRe.exec(line);
    if (!match) continue;
    const name = (match[1] ?? '').trim();
    const id = (match[2] ?? '').trim();
    if (name.toLowerCase() === 'account name') continue;
    ids.push(id);
  }
  return ids;
}

interface CiVariable {
  name: string;
  value: string;
}

export interface CiEnvironmentState {
  tokenReady: boolean;
  accountIdReady: boolean;
}

export function ciEnvironmentState(
  secretNames: readonly string[],
  variables: readonly CiVariable[],
  accountId: string,
): CiEnvironmentState {
  return {
    tokenReady: secretNames.includes('CLOUDFLARE_API_TOKEN'),
    accountIdReady: variables.some(
      (variable) => variable.name === 'CLOUDFLARE_ACCOUNT_ID' && variable.value === accountId,
    ),
  };
}

function readCiEnvironment(accountId: string, environment: string): CiEnvironmentState | null {
  const secrets = runCommand(`gh secret list --env ${environment} --json name`);
  const variables = runCommand(`gh variable list --env ${environment} --json name,value`);
  if (!secrets.ok || !variables.ok) return null;
  try {
    const secretRows = JSON.parse(secrets.stdout) as { name: string }[];
    const variableRows = JSON.parse(variables.stdout) as CiVariable[];
    return ciEnvironmentState(
      secretRows.map((row) => row.name),
      variableRows,
      accountId,
    );
  } catch {
    return null;
  }
}

function ciEnvironmentRows(
  state: CiEnvironmentState,
  environment: string,
): Parameters<typeof printToolTable>[1] {
  return [
    state.tokenReady
      ? { label: 'CLOUDFLARE_API_TOKEN', status: 'ready', detail: environment }
      : {
          label: 'CLOUDFLARE_API_TOKEN',
          status: 'failed',
          detail: `not set on the "${environment}" environment`,
        },
    state.accountIdReady
      ? { label: 'CLOUDFLARE_ACCOUNT_ID', status: 'ready', detail: environment }
      : {
          label: 'CLOUDFLARE_ACCOUNT_ID',
          status: 'failed',
          detail: `missing or does not match the active Cloudflare account`,
        },
  ];
}

interface CiEnvironment {
  environment: string;
  state: CiEnvironmentState;
}

function readCiEnvironments(accountId: string): CiEnvironment[] | null {
  const environments: CiEnvironment[] = [];
  for (const environment of REQUIRED_ENVIRONMENTS) {
    const state = readCiEnvironment(accountId, environment);
    if (!state) {
      log.error(`Could not read the "${environment}" GitHub Environment credentials.`);
      return null;
    }
    environments.push({ environment, state });
  }
  return environments;
}

/**
 * Runs one `gh ... set` per environment, stopping at the first refusal.
 *
 * Both credentials are written the same way and fail the same way, so they
 * share the loop; only the hint after a failure differs, and that belongs at
 * the call site that knows which credential it was writing.
 */
function setOnEnvironments(
  environments: readonly string[],
  command: (environment: string) => string,
  label: string,
): boolean {
  for (const environment of environments) {
    const result = runCommand(command(environment));
    if (!result.ok) {
      log.error(`Failed to set ${label} on "${environment}": ${result.stderr || result.stdout}`);
      return false;
    }
  }
  return true;
}

/**
 * Prompts for a Cloudflare API token, derives the account id from
 * `wrangler whoami` (no need to ask the user to hunt it down and paste it),
 * and writes both into every GitHub Environment the deployment workflows use
 * (see REQUIRED_ENVIRONMENTS) via `gh`. The token is passed straight to
 * `gh secret set` and never touches the general subprocess environment (see
 * the denylist in lib/shell.ts) or any on-disk file.
 *
 * The same token for every environment, because Cloudflare has no per-script
 * token scope: any token that can deploy a preview Worker can also overwrite
 * the production one. Separate environments buy separate deployment records
 * and somewhere to put a narrower token the day one exists — not isolation.
 */
export async function runCiSecretsPhase(
  options: { doctor: boolean } = { doctor: false },
): Promise<PhaseResult> {
  const whoami = runCommand('wrangler whoami');
  if (!whoami.ok) {
    log.error('`wrangler whoami` failed — make sure the auth phase succeeded first.');
    return { success: false };
  }

  const accountIds = parseAccountIds(whoami.stdout);
  const accountId = accountIds[0];
  if (accountId === undefined) {
    log.error('Could not parse an account id out of `wrangler whoami` output.');
    return { success: false };
  }
  log.info(`Using Cloudflare account id ${accountId} (from \`wrangler whoami\`).`);

  const environments = readCiEnvironments(accountId);
  if (!environments) return { success: false };

  const names = environments.map((entry) => entry.environment);
  const rows = environments.flatMap((entry) => ciEnvironmentRows(entry.state, entry.environment));

  if (environments.every((entry) => entry.state.tokenReady && entry.state.accountIdReady)) {
    printToolTable('CI secrets', rows);
    return { success: true };
  }

  // Doctor mode reports and returns. Prompting would make `pnpm preflight`
  // interactive, which defeats running it in a script or a fresh shell to
  // find out what is wrong.
  if (options.doctor) {
    printToolTable('CI secrets', rows);
    return { success: false };
  }

  const proceed = await promptConfirm(
    `Set missing CI credentials on the ${names.map((name) => `"${name}"`).join(' and ')} GitHub Environments now?`,
    true,
  );
  if (!proceed) return { success: false };

  // Prompted once even when several environments need it. Asking twice for the
  // same token invites two different tokens, and then one environment deploys
  // with credentials nobody knows about.
  const needsToken = environments.filter((entry) => !entry.state.tokenReady);
  if (needsToken.length > 0) {
    note(tokenPromptBody(accountId), 'Cloudflare API token');
    tryOpenInBrowser(tokenDashboardUrl(accountId));
    const token = await promptSecret('Paste the Cloudflare API token:');
    const written = setOnEnvironments(
      needsToken.map((entry) => entry.environment),
      (environment) =>
        `gh secret set CLOUDFLARE_API_TOKEN --env ${environment} --body ${shellEscape(token)}`,
      'CLOUDFLARE_API_TOKEN',
    );
    if (!written) {
      log.info(
        'If an environment does not exist yet, run `pnpm bootstrap` — the repository governance phase creates it.',
      );
      return { success: false };
    }
  }

  const wroteAccountId = setOnEnvironments(
    environments.filter((entry) => !entry.state.accountIdReady).map((entry) => entry.environment),
    (environment) =>
      `gh variable set CLOUDFLARE_ACCOUNT_ID --env ${environment} --body ${shellEscape(accountId)}`,
    'CLOUDFLARE_ACCOUNT_ID',
  );
  if (!wroteAccountId) return { success: false };

  log.success(
    `CLOUDFLARE_API_TOKEN (secret) and CLOUDFLARE_ACCOUNT_ID (variable) are set on ${names.join(' and ')}. CI deploys should work on the next push to main.`,
  );
  return { success: true };
}
