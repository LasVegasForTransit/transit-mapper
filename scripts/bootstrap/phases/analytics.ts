import {
  parseJsonOutput,
  resolveAccount,
  type CloudflareAccount,
} from '../lib/cloudflare-account.js';
import type { BootstrapIo } from '../lib/io.js';
import type { PhaseContext, PhaseResult } from '../lib/phase.js';
import type { ToolRow } from '../lib/ui.js';

/** The GitHub environment the release deploy reads these from. */
const ENVIRONMENT = 'production';

interface AnalyticsVariable {
  /** The GitHub environment variable `deploy-production.yml` reads. */
  name: string;
  /** The Cloudflare Web Analytics site the token belongs to. */
  host: string;
}

/**
 * One Web Analytics site per hostname TransitMapper is served on, as
 * docs/operations/how-to/analytics.md describes. The production workflow sets
 * LVBT_REQUIRE_ANALYTICS=1, so a missing token fails the release build: a
 * setup that stops before these is a setup whose first deploy fails.
 */
const ANALYTICS_VARIABLES: readonly AnalyticsVariable[] = [
  { name: 'PUBLIC_LVBT_CWA_TOKEN', host: 'map.lasvegasfortransit.org' },
  { name: 'PUBLIC_LVBT_LABS_CWA_TOKEN', host: 'labs.lasvegasfortransit.org' },
];

/** What a Web Analytics site token looks like: 32 letters and digits. */
const TOKEN_SHAPE = /^[0-9a-z]{32}$/iu;

function webAnalyticsUrl(account: CloudflareAccount): string {
  return `https://dash.cloudflare.com/${account.id}/web-analytics`;
}

/**
 * The dashboard steps for one site, shown before its prompt. One site at a
 * time, with its paste as the last step, so every copied token is pasted
 * before the next is copied.
 */
function analyticsSteps(account: CloudflareAccount, variable: AnalyticsVariable): string {
  return [
    `This is the Web Analytics token for ${variable.host}. The production`,
    'build refuses to deploy without it.',
    '',
    `  1. Open ${webAnalyticsUrl(account)}`,
    '     (opening it for you now).',
    `  2. If ${variable.host} is already listed, click "Manage site" on it`,
    '     and go to step 5.',
    `  3. Click "Add a site" and type ${variable.host}`,
    '  4. Choose "Enable with JS Snippet installation", not the automatic',
    '     "Enable" option: the site loads the beacon itself.',
    '  5. In the JS snippet, copy only the token inside',
    `     data-cf-beacon='{"token": "..."}' (32 letters and digits).`,
    '  6. Paste it below.',
    '',
    'The token is public, not a secret: every page view sends it. The',
    `bootstrap stores it as the ${variable.name} environment variable on the`,
    `"${ENVIRONMENT}" GitHub environment.`,
  ].join('\n');
}

/** Names of the variables the environment already holds a value for, or
 *  null when they could not be read. */
function variablesSet(io: BootstrapIo): string[] | null {
  const listed = io.run(`gh variable list --env ${ENVIRONMENT} --json name,value`);
  if (!listed.ok) return null;
  const rows = parseJsonOutput(listed.stdout);
  if (!Array.isArray(rows)) return null;
  return (rows as { name?: unknown; value?: unknown }[]).flatMap((row) =>
    typeof row.name === 'string' && typeof row.value === 'string' && row.value.trim()
      ? [row.name]
      : [],
  );
}

async function askAndStore(
  io: BootstrapIo,
  account: CloudflareAccount,
  variable: AnalyticsVariable,
): Promise<boolean> {
  io.note(analyticsSteps(account, variable), `Web Analytics: ${variable.host}`);
  io.openUrl(webAnalyticsUrl(account));
  const token = await io.text(`Paste the Web Analytics token for ${variable.host}:`, (value) =>
    TOKEN_SHAPE.test(value) ? undefined : 'Expected 32 letters and digits',
  );
  const result = io.run(`gh variable set ${variable.name} --env ${ENVIRONMENT}`, {
    input: token,
  });
  if (!result.ok) {
    io.log('error', `Failed to set ${variable.name}: ${result.stderr || result.stdout}`);
  }
  return result.ok;
}

/**
 * Makes sure the production environment holds a Web Analytics token for each
 * hostname, asking only for the ones it does not hold. A token already set is
 * never asked for again: it is public and stable, so there is nothing a
 * second copy would fix.
 */
export async function runAnalyticsPhase({ doctor, io }: PhaseContext): Promise<PhaseResult> {
  const set = variablesSet(io);
  if (!set) {
    io.table('Analytics variables', [
      {
        label: 'Web Analytics',
        status: 'failed',
        detail: `could not read the "${ENVIRONMENT}" environment variables`,
      },
    ]);
    return { success: false };
  }

  const missing = ANALYTICS_VARIABLES.filter((variable) => !set.includes(variable.name));
  const rows: ToolRow[] = ANALYTICS_VARIABLES.map((variable) =>
    missing.includes(variable)
      ? { label: variable.name, status: 'failed', detail: 'not set' }
      : { label: variable.name, status: 'ready', detail: variable.host },
  );
  io.table('Analytics variables', rows);
  if (missing.length === 0) return { success: true };
  if (doctor) return { success: false };

  const resolved = resolveAccount(io);
  if (!resolved.ok) {
    io.log('error', resolved.problem);
    return { success: false };
  }
  if (!(await io.confirm('Set the missing Web Analytics tokens now?', true))) {
    return { success: false };
  }
  for (const variable of missing) {
    if (!(await askAndStore(io, resolved.account, variable))) return { success: false };
  }
  return { success: true };
}
