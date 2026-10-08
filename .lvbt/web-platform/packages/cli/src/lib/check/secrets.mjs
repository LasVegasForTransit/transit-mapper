import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Reviewed official OCI image labels identify this digest as v8.30.1. Native execution must match.
export const GITLEAKS_VERSION = '8.30.1';
export const GITLEAKS_IMAGE =
  'ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f';
const PROBE_TIMEOUT = 5000;
const FIX = `Install Gitleaks ${GITLEAKS_VERSION}, or start Docker so the reviewed pinned image can run; never skip a configured secret scan.`;

function execute(command, args, { cwd, env, timeout }) {
  return spawnSync(command, args, {
    cwd,
    env,
    timeout,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function scanner(cwd, env) {
  const native = execute('gitleaks', ['version'], { cwd, env, timeout: PROBE_TIMEOUT });
  if (native.status === 0 && native.stdout.trim().replace(/^v/u, '') === GITLEAKS_VERSION)
    return {
      tool: 'gitleaks',
      detail: `Gitleaks ${GITLEAKS_VERSION} matches the reviewed scanner`,
    };
  const docker = execute('docker', ['info', '--format', '{{.ServerVersion}}'], {
    cwd,
    env,
    timeout: PROBE_TIMEOUT,
  });
  if (docker.status === 0)
    return {
      tool: 'docker',
      detail: `Docker is ready for the pinned Gitleaks ${GITLEAKS_VERSION} image`,
    };
  return {
    detail: `No exact Gitleaks ${GITLEAKS_VERSION} native scanner or available Docker daemon`,
  };
}

/** Read-only availability check. Repositories without product scanner rules need no scanner. */
export function secretScannerFinding({ cwd, env = process.env }) {
  if (!existsSync(path.join(cwd, '.gitleaks.toml'))) return undefined;
  const selected = scanner(cwd, env);
  return {
    ok: Boolean(selected.tool),
    label: 'secret scanner',
    detail: selected.detail,
    ...(!selected.tool ? { fix: FIX } : {}),
  };
}

/** Explicit expensive check, run as an uncached required Turbo validation dependency. */
export function checkSecrets({ cwd, env = process.env, timeout = 120000 }) {
  const result = { name: 'secrets', ok: true, lines: [], fix: FIX };
  const config = path.join(cwd, '.gitleaks.toml');
  if (!existsSync(config))
    return { ...result, lines: ['no .gitleaks.toml; secret scan is not configured'] };
  const history = execute('git', ['rev-parse', '--is-shallow-repository'], {
    cwd,
    env,
    timeout: PROBE_TIMEOUT,
  });
  if (history.status !== 0 || history.stdout.trim() !== 'false')
    return {
      ...result,
      ok: false,
      lines: ['Full Git history is required; repository history is shallow or unavailable.'],
      fix: 'Fetch full history (git fetch --unshallow); CI checkout must use fetch-depth: 0.',
    };
  const selected = scanner(cwd, env);
  if (!selected.tool) return { ...result, ok: false, lines: [selected.detail] };
  const container = `lvbt-secret-scan-${randomUUID()}`;
  const args =
    selected.tool === 'gitleaks'
      ? ['git', '--redact', '--no-banner', '--config', config]
      : dockerArguments(container, cwd, env);
  if (!args)
    return {
      ...result,
      ok: false,
      lines: ['Git metadata is unavailable; Docker cannot verify full repository history.'],
    };
  const scan = execute(selected.tool, args, { cwd, env, timeout });
  if (selected.tool === 'docker' && (scan.error || scan.signal))
    execute('docker', ['rm', '--force', container], { cwd, env, timeout: PROBE_TIMEOUT });
  return scanEvidence(scan, result);
}

function dockerArguments(container, cwd, env) {
  const directory = (flag) => {
    const probe = execute('git', ['rev-parse', '--path-format=absolute', flag], {
      cwd,
      env,
      timeout: PROBE_TIMEOUT,
    });
    return probe.status === 0 ? probe.stdout.trim() : undefined;
  };
  const common = directory('--git-common-dir');
  const git = directory('--git-dir');
  if (!common || !git || !path.isAbsolute(common) || !path.isAbsolute(git)) return undefined;
  const location = (file) => {
    const relative = path.relative(cwd, file);
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      ? file
      : path.posix.join('/repo', relative.split(path.sep).join('/'));
  };
  // A linked worktree's .git points outside its tree. Expose only Git metadata read-only,
  // at its existing absolute path so Git's relative commondir pointers remain valid.
  const mounts = location(common) === common ? ['-v', `${common}:${common}:ro`] : [];
  return [
    'run',
    '--rm',
    '--name',
    container,
    '-v',
    `${cwd}:/repo:ro`,
    ...mounts,
    '-e',
    `GIT_DIR=${location(git)}`,
    '-e',
    `GIT_COMMON_DIR=${location(common)}`,
    '-w',
    '/repo',
    GITLEAKS_IMAGE,
    'git',
    '--redact',
    '--no-banner',
    '--config',
    '/repo/.gitleaks.toml',
  ];
}

function scanEvidence(scan, result) {
  // Never echo scanner stdout/stderr: even failed or substituted executables cannot expose values.
  if (scan.error?.code === 'ETIMEDOUT')
    return {
      ...result,
      ok: false,
      lines: ['The full-history secret scan timed out; no passing evidence was produced.'],
    };
  if (scan.error || scan.signal)
    return {
      ...result,
      ok: false,
      lines: ['The secret scanner could not complete; no passing evidence was produced.'],
    };
  if (scan.status === 1)
    return {
      ...result,
      ok: false,
      lines: ['Secrets were detected in Git history.'],
      fix: 'Remove exposed values from history and rotate affected credentials; rerun pnpm check.',
    };
  if (scan.status !== 0)
    return {
      ...result,
      ok: false,
      lines: [`The secret scanner failed (exit ${scan.status}); no passing evidence was produced.`],
    };
  return {
    ...result,
    lines: [
      `Full-history redacted secret scan passed using reviewed Gitleaks ${GITLEAKS_VERSION}.`,
    ],
  };
}
