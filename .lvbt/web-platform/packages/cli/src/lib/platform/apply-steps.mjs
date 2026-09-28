import { randomBytes } from 'node:crypto';
import { redact } from './services.mjs';
import { paint } from './terminal.mjs';

/**
 * The small steps every part of setup shares: running Wrangler and gh,
 * storing a secret on its target, and showing a person numbered steps.
 *
 * Secret values live only in `context.values` for the length of the run.
 * They reach Wrangler and gh on stdin and are redacted from any output shown.
 */

export function generateSecret() {
  return randomBytes(32).toString('base64url');
}

export function account(context) {
  return `accounts/${context.manifest.cloudflare.accountId}`;
}

export function wrangler(context, args, options = {}) {
  return context.run('pnpm', ['exec', 'wrangler', ...args], {
    cwd: context.directory,
    env: {
      CLOUDFLARE_ACCOUNT_ID: context.manifest.cloudflare.accountId,
      WRANGLER_SEND_METRICS: 'false',
    },
    ...options,
  });
}

export function succeeded(result, secret) {
  if (result.status === 0) return;
  const output = `${result.stderr}\n${result.stdout}`.trim().split('\n').slice(-3).join(' ');
  throw new Error(redact(output || `exited with ${result.status}`, secret));
}

export function printGuide(io, guide) {
  if (guide.url) io.write(`Open: ${paint('cyan', guide.url)}\n`);
  guide.steps.forEach((step, index) => io.write(`  ${index + 1}. ${step}\n`));
}

/**
 * Show dashboard steps and wait. With `confirm`, ask whether the step is
 * done instead, and remember a yes on this computer, for what setup cannot
 * read for itself.
 */
export async function manualStep(context, { key, title, guide, confirm }) {
  if (context.handled.has(key)) return;
  context.handled.add(key);
  context.shown.add(key);
  const { io } = context;
  io.write(`\n${paint('bold', title)}\n`);
  printGuide(io, guide);
  if (guide.url && (await io.confirm('Open that page in your browser?', true))) io.open(guide.url);
  if (!confirm) {
    await io.ask('Press Enter when you have finished (or to leave it for later): ');
    return;
  }
  if (await io.confirm(confirm.question, false)) {
    context.confirmations.add(confirm.key);
    io.write(
      `Noted. Setup will not ask about it again on this computer; the note is in ${context.confirmations.where} and holds no secret.\n`,
    );
  } else io.write('It stays open, and setup asks again next time.\n');
}

export function targetName(context, target) {
  return target === 'worker'
    ? `Worker ${context.manifest.cloudflare.worker}`
    : `GitHub environment ${target.slice(7)}`;
}

export async function storeSecret(context, name, target, value) {
  if (target === 'worker') {
    succeeded(
      wrangler(context, ['secret', 'put', name, '--name', context.manifest.cloudflare.worker], {
        input: value,
      }),
      value,
    );
  } else {
    const repository = context.manifest.github.repository;
    succeeded(
      context.run('gh', ['secret', 'set', name, '--env', target.slice(7), '--repo', repository], {
        cwd: context.directory,
        input: value,
      }),
      value,
    );
  }
  context.handled.add(`secret:${name}:${target}`);
  const secret = context.manifest.secrets?.find((candidate) => candidate.name === name);
  const shown = secret?.sensitive === false ? ` = ${value}` : '';
  context.io.write(
    `${paint('green', 'Stored')} ${name}${shown} on ${targetName(context, target)}.\n`,
  );
}

/** Store a value a new resource produced, straight away, so it cannot be lost or left stale. */
export async function storeFed(context, name, value) {
  if (!value || !context.state.worker.ok || !context.state.worker.value.exists) return;
  context.values.set(name, value);
  await storeSecret(context, name, 'worker', value);
}
