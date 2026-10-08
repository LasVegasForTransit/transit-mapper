import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, realpath, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { parseAudit } from './adapters.mjs';
export { parseAudit } from './adapters.mjs';

export const checks = ['links', 'lighthouse', 'dependencies'];
export async function execute(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: result.status ?? 127,
    stdout: result.stdout ?? '',
    stderr: result.error?.message ?? result.stderr ?? '',
  };
}

async function existingAncestor(value) {
  try {
    return await realpath(value);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const entry = await lstat(value).catch(() => null);
    if (entry) throw new Error('Audit output contains an unresolved symlink.', { cause: error });
    return existingAncestor(path.dirname(value));
  }
}

async function withinRepository(cwd, value, directory = false) {
  if (typeof value !== 'string' || path.isAbsolute(value))
    throw new Error('Audit paths must be repository relative.');
  const resolved = path.resolve(cwd, value);
  if (resolved !== cwd && !resolved.startsWith(`${cwd}${path.sep}`))
    throw new Error('Audit path escapes outside the repository.');
  // Existing symlinks must not permit commands or outputs outside the repository.
  const canonical = directory ? await realpath(resolved) : await existingAncestor(resolved);
  const root = await realpath(cwd);
  if (canonical !== root && !canonical.startsWith(`${root}${path.sep}`))
    throw new Error('Audit path escapes outside the repository through a symlink.');
  return resolved;
}

function runIdentity(env, commit) {
  if (!env.GITHUB_RUN_ID) return null;
  return {
    id: env.GITHUB_RUN_ID,
    attempt: Number(env.GITHUB_RUN_ATTEMPT ?? 1),
    repository: env.GITHUB_REPOSITORY ?? '',
    headSha: commit,
    headBranch: env.GITHUB_REF_NAME ?? '',
    event: env.GITHUB_EVENT_NAME ?? '',
    workflow:
      env.GITHUB_WORKFLOW_REF?.split('@')[0]?.replace(`${env.GITHUB_REPOSITORY}/`, '') ?? '',
    url: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
  };
}

async function executeCheck({ cwd, env, run, name, adapter, result }) {
  const commandCwd = adapter.cwd ? await withinRepository(cwd, adapter.cwd, true) : cwd;
  const output = adapter.output ? await withinRepository(cwd, adapter.output) : null;
  result.command = adapter.command;
  if (adapter.output) result.artifacts.push(adapter.output);
  if (output) await rm(output, { force: true });
  const response = await run(adapter.command[0], adapter.command.slice(1), {
    cwd: commandCwd,
    env: { ...env, ...adapter.env },
  });
  if (response.stderr.trim()) result.diagnostics.push(response.stderr.trim());
  const content = output ? await readFile(output, 'utf8') : response.stdout;
  if (!content.trim())
    throw new Error(`Audit tool produced no JSON evidence (exit ${response.status}).`);
  const parsed = parseAudit(name, adapter.format, JSON.parse(content), response.status);
  result.status = parsed.status;
  result.findings = parsed.findings.map((finding) => ({
    ...finding,
    reproduction: adapter.command.join(' '),
    artifacts: result.artifacts,
  }));
}

async function runCheck({ cwd, config, configError, name, target, env, run }) {
  const result = {
    check: name,
    target,
    status: 'error',
    command: [],
    findings: [],
    diagnostics: [],
    artifacts: [],
  };
  try {
    if (configError) throw new Error(configError);
    if (!checks.includes(name)) throw new Error(`Unknown audit check: ${name}.`);
    if (!['local', 'production'].includes(target))
      throw new Error(`Unknown audit target: ${target}.`);
    const adapter =
      config.audits?.[name]?.[target] ??
      (name === 'dependencies'
        ? { command: ['pnpm', 'audit', '--prod', '--audit-level=low', '--json'], format: 'pnpm' }
        : null);
    if (!adapter) throw new Error(`No ${name} audit configured for ${target}.`);
    if (
      !Array.isArray(adapter.command) ||
      !adapter.command.length ||
      adapter.command.some((argument) => typeof argument !== 'string' || !argument.length)
    )
      throw new Error('Audit command must be a non-empty argument array.');
    await executeCheck({ cwd, env, run, name, adapter, result });
  } catch (error) {
    result.status = 'error';
    result.diagnostics.push(error.message);
  }
  return result;
}

export async function runAudits({
  cwd,
  config = {},
  configError,
  check,
  target = 'local',
  env = process.env,
  execute: run = execute,
}) {
  cwd = path.resolve(cwd);
  const commitResult = await run('git', ['rev-parse', 'HEAD'], { cwd, env });
  const commit = commitResult.status === 0 ? commitResult.stdout.trim() : (env.GITHUB_SHA ?? null);
  const report = {
    version: 1,
    repository: env.GITHUB_REPOSITORY ?? null,
    commit,
    run: runIdentity(env, commit),
    target,
    results: [],
  };
  const requested = check
    ? [check]
    : checks.filter((name) => name === 'dependencies' || config.audits?.[name]?.[target]);
  for (const name of requested)
    report.results.push(await runCheck({ cwd, config, configError, name, target, env, run }));
  return report;
}

export async function audit({ cwd, options }) {
  const positionals = options.positional?.filter((value) => value !== 'audit') ?? [];
  if (positionals[0] === 'report') {
    const { reportAudit } = await import('./report.mjs');
    const result = await reportAudit({
      cwd,
      input: options.input,
      dryRun: options.dryRun ?? options['dry-run'] ?? false,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  const { readTooling } = await import('../tooling.mjs');
  let config = {};
  let configError;
  try {
    config = await readTooling(cwd);
  } catch (error) {
    configError = error.message;
  }
  if (positionals.length > 1) configError = 'Audit accepts at most one check name.';
  const report = await runAudits({
    cwd,
    config,
    configError,
    check: positionals[0],
    target: options.target ?? 'local',
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    const destination = path.resolve(cwd, options.output);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, serialized);
  }
  process.stdout.write(
    options.json
      ? serialized
      : report.results
          .map(
            (result) =>
              `${result.check} (${result.target}): ${result.status}${result.diagnostics.length ? ` — ${result.diagnostics.join('; ')}` : ''}\n`,
          )
          .join(''),
  );
  return report.results.some((result) => result.status !== 'pass') ? 1 : 0;
}
