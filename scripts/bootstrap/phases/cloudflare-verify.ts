import { accountEnv, resolveAccount } from '../lib/cloudflare-account.js';
import type { PhaseContext, PhaseResult } from '../lib/phase.js';
import type { ToolRow } from '../lib/ui.js';
import {
  DATABASES,
  databaseId,
  databaseName,
  readWranglerToml,
  WRANGLER,
} from '../lib/wrangler-config.js';

/**
 * Read-only checks against what Task 5 of the deploy plan provisions by
 * hand: the real D1 databases and the custom-domain route. This phase never
 * creates anything — it exists so re-running bootstrap on a fresh clone (or
 * after someone forgets whether setup finished) gives a clear yes/no instead
 * of silently doing nothing.
 */
export function runCloudflareVerifyPhase({ io }: PhaseContext): Promise<PhaseResult> {
  const rows: ToolRow[] = [];
  let allReady = true;

  const toml = readWranglerToml(io);
  const resolved = resolveAccount(io);
  if (!resolved.ok) {
    io.table('Cloudflare deployment config', [
      { label: 'Cloudflare account', status: 'failed', detail: resolved.problem },
    ]);
    return Promise.resolve({ success: false });
  }
  const list = io.run(`${WRANGLER} d1 list`, { env: accountEnv(resolved.account) });

  // Reported once, as itself. Without this every database below is described
  // as "not found in this account", which sends the reader looking for
  // databases that exist while the actual problem is that the command asking
  // about them could not run.
  if (!list.ok) {
    io.table('Cloudflare deployment config', [
      {
        label: 'D1',
        status: 'failed',
        detail: 'could not list databases — is `wrangler login` still valid?',
      },
    ]);
    return Promise.resolve({ success: false });
  }

  for (const { environment, label } of DATABASES) {
    const dbId = databaseId(toml, environment);
    const name = databaseName(toml, environment) ?? environment;
    if (!dbId) {
      rows.push({
        label: `${label} id`,
        status: 'failed',
        detail: `wrangler.toml still has the placeholder id — run \`wrangler d1 create ${name}\` first`,
      });
      allReady = false;
      continue;
    }
    if (list.stdout.includes(dbId)) {
      rows.push({ label, status: 'ready', detail: dbId });
    } else {
      rows.push({
        label,
        status: 'failed',
        detail: `id ${dbId} not found in \`wrangler d1 list\` for the currently authenticated account`,
      });
      allReady = false;
    }
  }

  const hasCustomDomainRoute = toml.includes('[[routes]]') && /custom_domain\s*=\s*true/.test(toml);
  if (hasCustomDomainRoute) {
    const patternMatch = /pattern\s*=\s*"([^"]+)"/.exec(toml);
    rows.push({
      label: 'Custom domain route',
      status: 'ready',
      detail: patternMatch?.[1] ?? 'configured',
    });
  } else {
    rows.push({
      label: 'Custom domain route',
      status: 'failed',
      detail: 'no `[[routes]]` with custom_domain = true in wrangler.toml',
    });
    allReady = false;
  }

  io.table('Cloudflare deployment config', rows);
  // Nothing here awaits: the phase interface is async because other phases
  // prompt, and this one only reads.
  return Promise.resolve({ success: allReady });
}
