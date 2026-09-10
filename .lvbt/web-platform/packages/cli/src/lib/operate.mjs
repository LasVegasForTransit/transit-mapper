import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CliError } from './arguments.mjs';
import { exists, readJson } from './files.mjs';

function output(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/** `>=x.y.z` and `^x.y.z` against a version; anything else passes on the major. */
function satisfies(version, range) {
  const wanted = /^(?:>=|\^)?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);
  if (!wanted) return true;
  const have = version.split('.').map(Number);
  const need = [Number(wanted[1]), Number(wanted[2] ?? 0), Number(wanted[3] ?? 0)];
  if (range.startsWith('^') && have[0] !== need[0]) return false;
  for (let index = 0; index < 3; index += 1) {
    if (have[index] > need[index]) return true;
    if (have[index] < need[index]) return false;
  }
  return true;
}

const WRANGLER_FILES = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];

export function wranglerDeployArguments(commit, dryRun) {
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new CliError('deploy: provenance requires a full Git commit.', 2);
  return [
    'exec',
    'wrangler',
    'deploy',
    '--strict',
    '--message',
    `Commit ${commit}`,
    ...(dryRun ? ['--dry-run'] : []),
  ];
}

function deploymentCommit(cwd) {
  const commit = output('git', ['rev-parse', 'HEAD'], cwd);
  if (commit === undefined || !/^[a-f0-9]{40}$/.test(commit))
    throw new CliError('deploy: repository HEAD is unavailable.', 2);
  const expected = process.env.GITHUB_SHA?.trim();
  if (expected !== undefined && expected !== commit)
    throw new CliError('deploy: checkout does not match the triggering GitHub commit.', 2);
  const changed = output('git', ['status', '--porcelain', '--untracked-files=normal'], cwd);
  if (changed === undefined || changed !== '')
    throw new CliError('deploy: commit or move local changes before deploying.', 2);
  return commit;
}

async function wranglerConfig(directory) {
  for (const file of WRANGLER_FILES) {
    if (await exists(path.join(directory, file))) return file;
  }
  return undefined;
}

/** Every directory with a wrangler config: the root, then each apps/*. */
async function deployables(cwd) {
  const found = [];
  if (await wranglerConfig(cwd)) found.push('.');
  const apps = await readdir(path.join(cwd, 'apps'), { withFileTypes: true }).catch(() => []);
  for (const entry of apps) {
    if (entry.isDirectory() && (await wranglerConfig(path.join(cwd, 'apps', entry.name)))) {
      found.push(`apps/${entry.name}`);
    }
  }
  return found;
}

async function toolchainFindings(cwd, packageJson, report) {
  const nodeRange = packageJson.engines?.node ?? '>=24';
  if (satisfies(process.versions.node, nodeRange))
    report.pass('Node.js', `${process.versions.node} satisfies ${nodeRange}`);
  else
    report.fail(
      'Node.js',
      `${process.versions.node} does not satisfy ${nodeRange}`,
      'install the Node.js version engines.node names, for example with fnm or nvm',
    );

  const wantedPnpm = /^pnpm@(\S+)/.exec(packageJson.packageManager ?? '')?.[1];
  const pnpm = output('pnpm', ['--version'], cwd);
  if (!wantedPnpm)
    report.fail(
      'pnpm',
      'package.json has no packageManager field',
      'add "packageManager": "pnpm@<version>" to package.json',
    );
  else if (!pnpm)
    report.fail(
      'pnpm',
      'pnpm is not installed',
      `corepack enable && corepack prepare ${packageJson.packageManager} --activate`,
    );
  else if (pnpm !== wantedPnpm)
    report.fail(
      'pnpm',
      `${pnpm} is installed, ${wantedPnpm} is pinned`,
      `corepack prepare pnpm@${wantedPnpm} --activate`,
    );
  else report.pass('pnpm', `${pnpm} matches packageManager`);

  if (await exists(path.join(cwd, 'node_modules')))
    report.pass('dependencies', 'node_modules is present');
  else report.fail('dependencies', 'node_modules is missing', 'pnpm install');
}

async function repositoryFindings(cwd, report) {
  const hooksPath = output('git', ['config', '--local', 'core.hooksPath'], cwd);
  if (hooksPath === '.githooks') report.pass('git hooks', 'core.hooksPath is .githooks');
  else
    report.fail(
      'git hooks',
      `core.hooksPath is ${hooksPath ?? 'unset'}`,
      'pnpm install   # the prepare script sets it',
    );

  const scopes = await readFile(path.join(cwd, '.lvbt/commit-scopes.txt'), 'utf8').catch(
    () => undefined,
  );
  if (scopes) report.pass('commit scopes', '.lvbt/commit-scopes.txt is present');
  else
    report.fail(
      'commit scopes',
      '.lvbt/commit-scopes.txt is missing',
      "copy .lvbt/commit-scopes.txt from the standard example and list this repository's scopes",
    );

  // Issues and pull requests are created by people, so a runner does not need gh.
  if (process.env.CI) {
    report.pass('GitHub CLI', 'not needed in CI');
    return;
  }
  const gh = output('gh', ['auth', 'status'], cwd);
  if (gh !== undefined) report.pass('GitHub CLI', 'gh is installed and signed in');
  else
    report.fail(
      'GitHub CLI',
      'gh is missing or not signed in',
      'brew install gh && gh auth login   # issues and pull requests are created through it',
    );
}

async function cloudflareFindings(cwd, report) {
  const targets = await deployables(cwd);
  if (targets.length === 0) {
    report.pass('Cloudflare', 'no wrangler config; nothing to deploy from here');
    return;
  }
  const whoami = output('pnpm', ['exec', 'wrangler', 'whoami'], cwd);
  if (whoami && !/not authenticated/i.test(whoami))
    report.pass('Cloudflare', `wrangler is signed in; deployables: ${targets.join(', ')}`);
  else report.fail('Cloudflare', 'wrangler is not signed in', 'pnpm exec wrangler login');
}

/**
 * Confirm the machine can work on this repository. Every finding names the
 * command that fixes it; the exit code is 1 when anything failed.
 */
export async function preflight({ cwd }) {
  const packageJson = await readJson(path.join(cwd, 'package.json'));
  const findings = [];
  const report = {
    pass: (label, detail) => findings.push({ ok: true, label, detail }),
    fail: (label, detail, fix) => findings.push({ ok: false, label, detail, fix }),
  };

  await toolchainFindings(cwd, packageJson, report);
  await repositoryFindings(cwd, report);
  await cloudflareFindings(cwd, report);

  for (const finding of findings) {
    process.stdout.write(
      `  ${finding.ok ? 'ok  ' : 'FAIL'}  ${finding.label.padEnd(14)} ${finding.detail}\n`,
    );
    if (!finding.ok) process.stdout.write(`        fix: ${finding.fix}\n`);
  }
  const failed = findings.filter((finding) => !finding.ok);
  if (failed.length > 0)
    throw new CliError(`preflight: ${failed.length} of ${findings.length} checks failed`, 1);
  process.stdout.write(`preflight: all ${findings.length} checks passed\n`);
}

/** Install, wire hooks, and confirm the machine is ready. */
export async function bootstrap({ cwd }) {
  process.stdout.write('pnpm install\n');
  const install = spawnSync('pnpm', ['install'], { cwd, stdio: 'inherit' });
  if (install.status !== 0)
    throw new CliError('bootstrap: pnpm install failed', install.status ?? 1);
  await preflight({ cwd });
}

/**
 * Build, then deploy with Wrangler: the same steps every deployable repository
 * runs. Every app with a wrangler config deploys, or just the one `--filter`
 * names.
 */
export async function deploy({ cwd, options }) {
  let targets = await deployables(cwd);
  if (options.filter)
    targets = targets.filter(
      (target) => target === options.filter || target === `apps/${options.filter}`,
    );
  if (targets.length === 0) {
    throw new CliError(
      options.filter
        ? `deploy: ${options.filter} has no wrangler.jsonc, wrangler.json, or wrangler.toml.`
        : 'deploy: no wrangler.jsonc, wrangler.json, or wrangler.toml at the root or under apps/.',
      2,
    );
  }

  const commit = deploymentCommit(cwd);

  process.stdout.write('pnpm build\n');
  const build = spawnSync('pnpm', ['build'], { cwd, stdio: 'inherit' });
  if (build.status !== 0) throw new CliError('deploy: build failed', build.status ?? 1);

  for (const target of targets) {
    if (deploymentCommit(cwd) !== commit)
      throw new CliError('deploy: repository changed after the production build.', 2);
    const args = wranglerDeployArguments(commit, options.dryRun);
    process.stdout.write(`${target}: pnpm ${args.join(' ')}\n`);
    const result = spawnSync('pnpm', args, { cwd: path.join(cwd, target), stdio: 'inherit' });
    if (result.status !== 0)
      throw new CliError(`deploy: wrangler deploy failed in ${target}`, result.status ?? 1);
  }
}
