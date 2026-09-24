import type { PhaseContext, PhaseResult } from '../lib/phase.js';
import type { ToolRow } from '../lib/ui.js';

interface AuthTool {
  label: string;
  checkCommand: string;
  loginCommand: string;
}

const AUTH_TOOLS: AuthTool[] = [
  {
    label: 'GitHub CLI',
    checkCommand: 'gh auth status',
    loginCommand: 'gh auth login',
  },
  {
    label: 'Cloudflare Wrangler',
    checkCommand: "wrangler whoami 2>/dev/null | grep -q '@'",
    loginCommand: 'wrangler login',
  },
];

/** Confirms `gh` and `wrangler` are both authenticated, offering to log in
 *  interactively when either isn't. Neither tool's absence is fatal here —
 *  a missing binary just gets reported as failed with the login command to
 *  run once it's installed. */
export async function runAuthPhase({ doctor, io }: PhaseContext): Promise<PhaseResult> {
  const rows: ToolRow[] = [];
  let allReady = true;

  for (const tool of AUTH_TOOLS) {
    const check = io.run(tool.checkCommand);
    if (check.ok) {
      rows.push({ label: tool.label, status: 'ready', detail: 'authenticated' });
      continue;
    }

    if (doctor) {
      rows.push({
        label: tool.label,
        status: 'failed',
        detail: `not authenticated — run \`${tool.loginCommand}\``,
      });
      allReady = false;
      continue;
    }

    if (rows.length > 0) {
      io.table('CLI authentication', rows);
      rows.length = 0;
    }

    const shouldAuth = await io.confirm(`${tool.label} is not authenticated. Log in now?`, true);
    if (!shouldAuth) {
      rows.push({
        label: tool.label,
        status: 'deferred',
        detail: `run \`${tool.loginCommand}\` later`,
      });
      allReady = false;
      continue;
    }

    const loginOk = io.runInteractive(tool.loginCommand);
    const recheck = loginOk ? io.run(tool.checkCommand) : { ok: false, stdout: '', stderr: '' };
    if (recheck.ok) {
      rows.push({ label: tool.label, status: 'ready', detail: 'authenticated' });
    } else {
      rows.push({ label: tool.label, status: 'failed', detail: 'login did not stick' });
      allReady = false;
    }
  }

  io.table('CLI authentication', rows);
  if (!allReady) {
    io.log(
      'warn',
      'Continuing — later phases that need gh/wrangler will fail until you authenticate both.',
    );
  }
  return { success: allReady };
}
