import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const STAMP = 'node_modules/.lvbt-install.json';
const LEGACY = 'node_modules/.lvbt-lockfile-hash';
function lockfileHash(cwd) {
  return createHash('sha256')
    .update(readFileSync(path.join(cwd, 'pnpm-lock.yaml')))
    .digest('hex');
}
export function recordInstall(cwd, { node = process.versions.node, pnpm }) {
  if (!pnpm) throw new Error('Cannot record installation without the installed pnpm version.');
  const fingerprint = { version: 1, node, pnpm, lockfile: lockfileHash(cwd) };
  writeFileSync(path.join(cwd, STAMP), `${JSON.stringify(fingerprint)}\n`, { mode: 0o600 });
}
export function checkInstall(cwd, { node = process.versions.node, pnpm }) {
  const label = 'installed tree';
  const fail = (detail) => ({ ok: false, label, detail, fix: 'pnpm bootstrap' });
  const stamp = path.join(cwd, STAMP);
  let lockfile;
  try {
    lockfile = lockfileHash(cwd);
  } catch {
    return fail('pnpm-lock.yaml is missing or unreadable');
  }
  if (!existsSync(stamp)) {
    const legacy = path.join(cwd, LEGACY);
    if (existsSync(legacy) && readFileSync(legacy, 'utf8').trim() !== lockfile)
      return fail('node_modules was installed from a different pnpm-lock.yaml');
    return {
      ok: true,
      warning: true,
      label,
      detail: 'This pre-0.7 installation has no shared fingerprint yet.',
      fix: 'pnpm bootstrap',
    };
  }
  let recorded;
  try {
    recorded = JSON.parse(readFileSync(stamp, 'utf8'));
  } catch {
    return fail('The install fingerprint is unreadable.');
  }
  if (
    recorded?.version !== 1 ||
    recorded.node !== node ||
    recorded.pnpm !== pnpm ||
    recorded.lockfile !== lockfile
  )
    return fail('node_modules does not match the current Node, pnpm, and lockfile');
  return { ok: true, label, detail: 'matches Node, pnpm, and pnpm-lock.yaml' };
}
