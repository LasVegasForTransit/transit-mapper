#!/usr/bin/env tsx
/**
 * TransitMapper Bootstrap CLI
 *
 * Usage:
 *   pnpm bootstrap    — set the project up, creating what does not exist
 *   pnpm preflight    — report what is wrong, change nothing
 *
 *   pnpm bootstrap --rotate-token
 *       also replace the CLOUDFLARE_API_TOKEN secret that is already set
 *   pnpm bootstrap --replace-account-id
 *       also overwrite a CLOUDFLARE_ACCOUNT_ID variable naming another account
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
import { resolve } from 'node:path';
import { intro, outro, note } from '@clack/prompts';
import { nodeIo, type BootstrapIo } from './lib/io.js';
import type { PhaseContext, PhaseResult } from './lib/phase.js';
import { runAuthPhase } from './phases/auth.js';
import { runCloudflareVerifyPhase } from './phases/cloudflare-verify.js';
import { runCiSecretsPhase } from './phases/ci-secrets.js';
import { runProvisionPhase } from './phases/provision.js';
import { runWorkspacePhase } from './phases/workspace.js';
import { runRepoConfigPhase } from './phases/repo-config.js';

interface Phase {
  id: string;
  title: string;
  run: (context: PhaseContext) => Promise<PhaseResult>;
}

const PHASES: readonly Phase[] = [
  { id: 'workspace', title: 'Workspace', run: runWorkspacePhase },
  { id: 'auth', title: 'CLI authentication', run: runAuthPhase },
  { id: 'provision', title: 'Cloudflare resources', run: runProvisionPhase },
  { id: 'cloudflare-verify', title: 'Deployment configuration', run: runCloudflareVerifyPhase },
  { id: 'repo-config', title: 'Repository governance', run: runRepoConfigPhase },
  { id: 'ci-secrets', title: 'CI secrets', run: runCiSecretsPhase },
];

export type BootstrapOptions = Omit<PhaseContext, 'io'>;

/**
 * Every flag the CLI accepts. Replacing a value that is already set is never
 * a default: it happens only when the person names it here.
 */
const FLAGS: Readonly<Record<string, keyof BootstrapOptions>> = {
  '--doctor': 'doctor',
  '--rotate-token': 'rotateToken',
  '--replace-account-id': 'replaceAccountId',
};

/**
 * Reads the flags, or says which one it did not recognise.
 *
 * An unknown flag is an error rather than ignored: a misspelt
 * `--rotate-tokn` that quietly did nothing would leave somebody believing a
 * leaked token had been replaced.
 */
export function parseArguments(argv: readonly string[]): BootstrapOptions | { unknown: string } {
  const options: BootstrapOptions = { doctor: false, rotateToken: false, replaceAccountId: false };
  for (const argument of argv) {
    // pnpm forwards a bare `--` separator when one is typed; it is not a flag.
    if (argument === '--') continue;
    const key = FLAGS[argument];
    if (!key) return { unknown: argument };
    options[key] = true;
  }
  return options;
}

export interface BootstrapOutcome {
  success: boolean;
  /** Titles of the phases that did not succeed, in the order they ran. */
  failed: string[];
}

/**
 * Runs every phase in order against `io`.
 *
 * Separate from `main` so a test can drive the whole flow against fakes and
 * read the outcome, instead of watching the process exit.
 */
export async function runBootstrap(
  options: BootstrapOptions,
  io: BootstrapIo,
): Promise<BootstrapOutcome> {
  const context: PhaseContext = { ...options, io };
  const failed: string[] = [];

  for (const phase of PHASES) {
    // In doctor mode every phase runs, because a report that stops at the
    // first problem hides the other three. A real run stops, because later
    // phases assume the earlier ones succeeded.
    const result = await phase.run(context);
    if (result.success) continue;

    failed.push(phase.title);
    if (!options.doctor) break;
  }

  return { success: failed.length === 0, failed };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if ('unknown' in options) {
    console.error(`Unknown option ${options.unknown}. Accepted: ${Object.keys(FLAGS).join(', ')}.`);
    process.exit(2);
  }
  const { doctor } = options;

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

  const outcome = await runBootstrap(options, nodeIo());

  if (outcome.success) {
    outro(doctor ? 'Everything checks out.' : 'Bootstrap complete.');
    return;
  }

  outro(
    doctor
      ? `${outcome.failed.length} problem(s): ${outcome.failed.join(', ')}. Run \`pnpm bootstrap\` to fix.`
      : `Stopped at "${outcome.failed[0] ?? ''}" — fix the issue above and re-run \`pnpm bootstrap\`.`,
  );
  process.exit(1);
}

// Only run when invoked directly, so a test can import `runBootstrap`.
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
