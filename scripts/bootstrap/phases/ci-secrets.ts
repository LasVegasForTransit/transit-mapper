import { log, note } from '@clack/prompts';
import { runCommand, shellEscape, tryOpenInBrowser } from '../lib/shell.js';
import { printToolTable, promptConfirm, promptSecret } from '../lib/ui.js';
import type { PhaseResult } from './auth.js';

const GITHUB_ENVIRONMENT = 'production';

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

function readCiEnvironment(accountId: string): CiEnvironmentState | null {
  const secrets = runCommand(`gh secret list --env ${GITHUB_ENVIRONMENT} --json name`);
  const variables = runCommand(`gh variable list --env ${GITHUB_ENVIRONMENT} --json name,value`);
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

function ciEnvironmentRows(state: CiEnvironmentState): Parameters<typeof printToolTable>[1] {
  return [
    state.tokenReady
      ? { label: 'CLOUDFLARE_API_TOKEN', status: 'ready', detail: GITHUB_ENVIRONMENT }
      : {
          label: 'CLOUDFLARE_API_TOKEN',
          status: 'failed',
          detail: `not set on the "${GITHUB_ENVIRONMENT}" environment`,
        },
    state.accountIdReady
      ? { label: 'CLOUDFLARE_ACCOUNT_ID', status: 'ready', detail: GITHUB_ENVIRONMENT }
      : {
          label: 'CLOUDFLARE_ACCOUNT_ID',
          status: 'failed',
          detail: `missing or does not match the active Cloudflare account`,
        },
  ];
}

/**
 * Prompts for a Cloudflare API token, derives the account id from
 * `wrangler whoami` (no need to ask the user to hunt it down and paste it),
 * and writes both into the repo's `production` GitHub Environment via `gh`.
 * The token is passed straight to `gh secret set` and never touches the
 * general subprocess environment (see the denylist in lib/shell.ts) or any
 * on-disk file.
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

  const existing = readCiEnvironment(accountId);
  if (!existing) {
    log.error(`Could not read the "${GITHUB_ENVIRONMENT}" GitHub Environment credentials.`);
    return { success: false };
  }

  if (existing.tokenReady && existing.accountIdReady) {
    printToolTable('CI secrets', ciEnvironmentRows(existing));
    return { success: true };
  }

  // Doctor mode reports and returns. Prompting would make `pnpm preflight`
  // interactive, which defeats running it in a script or a fresh shell to
  // find out what is wrong.
  if (options.doctor) {
    printToolTable('CI secrets', ciEnvironmentRows(existing));
    return { success: false };
  }

  const proceed = await promptConfirm(
    `Set missing CI credentials on the "${GITHUB_ENVIRONMENT}" GitHub Environment now?`,
    true,
  );
  if (!proceed) {
    return { success: false };
  }

  if (!existing.tokenReady) {
    note(tokenPromptBody(accountId), 'Cloudflare API token');
    tryOpenInBrowser(tokenDashboardUrl(accountId));

    const token = await promptSecret('Paste the Cloudflare API token:');
    const setToken = runCommand(
      `gh secret set CLOUDFLARE_API_TOKEN --env ${GITHUB_ENVIRONMENT} --body ${shellEscape(token)}`,
    );
    if (!setToken.ok) {
      log.error(`Failed to set CLOUDFLARE_API_TOKEN: ${setToken.stderr || setToken.stdout}`);
      log.info(
        `If the "${GITHUB_ENVIRONMENT}" environment doesn't exist yet, create it first: repo Settings → Environments → New environment.`,
      );
      return { success: false };
    }
  }

  if (!existing.accountIdReady) {
    const setAccountId = runCommand(
      `gh variable set CLOUDFLARE_ACCOUNT_ID --env ${GITHUB_ENVIRONMENT} --body ${shellEscape(accountId)}`,
    );
    if (!setAccountId.ok) {
      log.error(
        `Failed to set CLOUDFLARE_ACCOUNT_ID: ${setAccountId.stderr || setAccountId.stdout}`,
      );
      return { success: false };
    }
  }

  log.success(
    `CLOUDFLARE_API_TOKEN (secret) and CLOUDFLARE_ACCOUNT_ID (variable) are set on "${GITHUB_ENVIRONMENT}". CI deploys should work on the next push to main.`,
  );
  return { success: true };
}
