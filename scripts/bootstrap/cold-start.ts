#!/usr/bin/env tsx
/**
 * TransitMapper Bootstrap CLI
 *
 * Usage:
 *   pnpm bootstrap    — set the project up, creating what does not exist
 *   pnpm preflight    — report what is wrong, change nothing
 *
 * Phases run in order, and the order is deliberate: everything local and
 * reversible happens before anything is created in someone's Cloudflare
 * account, so a broken toolchain cannot leave a half-built account behind.
 *
 *   workspace   — Node and pnpm versions, install, and `pnpm check`
 *   auth        — confirm gh and wrangler are logged in
 *   provision   — create the D1 database if it does not exist, write its id
 *                 into wrangler.toml, and apply migrations
 *   repo-config — apply the organization's governance standard to the
 *                 GitHub repository: branch rules, dependency and secret
 *                 scanning, and Actions permissions
 *   ci-secrets  — CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID on the
 *                 "production" GitHub Environment
 *
 * The same phase-array pattern — a plain array of { id, title, run }, with
 * `note()`-driven UX via @clack/prompts — is used by the org's other
 * Cloudflare-deployed project, LasVegasForTransit/website. Kept consistent
 * across repositories on purpose rather than each inventing its own shape.
 *
 * There is still no resumable state file. Every phase is idempotent and
 * cheap to re-run, so resuming means running it again; a state file would be
 * one more thing that can be wrong.
 */
import { intro, outro, note } from '@clack/prompts';
import { runAuthPhase } from './phases/auth.js';
import { runCloudflareVerifyPhase } from './phases/cloudflare-verify.js';
import { runCiSecretsPhase } from './phases/ci-secrets.js';
import { runProvisionPhase } from './phases/provision.js';
import { runWorkspacePhase } from './phases/workspace.js';
import { runRepoConfigPhase } from './phases/repo-config.js';

interface PhaseContext {
  /** Report problems, create and write nothing. */
  doctor: boolean;
}

interface Phase {
  id: string;
  title: string;
  run: (context: PhaseContext) => Promise<{ success: boolean }>;
}

const PHASES: readonly Phase[] = [
  { id: 'workspace', title: 'Workspace', run: runWorkspacePhase },
  { id: 'auth', title: 'CLI authentication', run: runAuthPhase },
  { id: 'provision', title: 'Cloudflare resources', run: runProvisionPhase },
  {
    id: 'cloudflare-verify',
    title: 'Deployment configuration',
    run: () => runCloudflareVerifyPhase(),
  },
  { id: 'repo-config', title: 'Repository governance', run: runRepoConfigPhase },
  { id: 'ci-secrets', title: 'CI secrets', run: runCiSecretsPhase },
];

async function main(): Promise<void> {
  const doctor = process.argv.includes('--doctor');

  intro(doctor ? 'TransitMapper preflight' : 'TransitMapper bootstrap');

  if (doctor) {
    note(
      [
        'Reporting only. Nothing is installed, created, or written.',
        'Run `pnpm bootstrap` to fix what this finds.',
      ].join('\n'),
      'Read-only',
    );
  }

  const failed: string[] = [];

  for (const phase of PHASES) {
    // In doctor mode every phase runs, because a report that stops at the
    // first problem hides the other three. A real run stops, because later
    // phases assume the earlier ones succeeded.
    const result = await phase.run({ doctor });
    if (result.success) continue;

    failed.push(phase.title);
    if (!doctor) {
      outro(`Stopped at "${phase.title}" — fix the issue above and re-run \`pnpm bootstrap\`.`);
      process.exit(1);
    }
  }

  if (failed.length > 0) {
    outro(`${failed.length} problem(s): ${failed.join(', ')}. Run \`pnpm bootstrap\` to fix.`);
    process.exit(1);
  }

  outro(doctor ? 'Everything checks out.' : 'Bootstrap complete.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
