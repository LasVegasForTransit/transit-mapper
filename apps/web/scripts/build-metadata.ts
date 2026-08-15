import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BuildInfo } from '../src/build-info';

export interface GitBuildState {
  commitSha: string;
  dirty: boolean;
}

interface LoadBuildInfoOptions {
  repositoryRoot: string;
  environment?: NodeJS.ProcessEnv;
  git?: GitBuildState | null;
  now?: Date;
}

interface PackageManifest {
  version?: unknown;
  repository?: unknown;
}

const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;
const DAY_MS = 24 * 60 * 60 * 1_000;

function repositoryUrl(value: unknown): string {
  const raw =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && 'url' in value
        ? (value as { url?: unknown }).url
        : undefined;
  if (typeof raw !== 'string') throw new Error('package.json must declare a repository URL');

  const normalized = raw.replace(/^git\+/, '').replace(/\.git$/, '');
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(normalized)) {
    throw new Error(`repository URL is not a canonical GitHub URL: ${raw}`);
  }
  return normalized;
}

function copyrightNotice(license: string): string {
  const notices = license.match(/^Copyright \(c\) .+$/gm) ?? [];
  if (notices.length !== 1) {
    throw new Error(`LICENSE must contain exactly one copyright notice; found ${notices.length}`);
  }
  return notices[0];
}

function packageVersion(manifest: PackageManifest): string {
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error('package.json must declare a version');
  }
  return manifest.version;
}

function releaseTagFor(environment: NodeJS.ProcessEnv, version: string): string | null {
  const releaseTag = environment.TRANSITMAPPER_RELEASE_TAG ?? null;
  if (releaseTag && releaseTag !== `v${version}`) {
    throw new Error(`release tag ${releaseTag} does not match package version ${version}`);
  }
  return releaseTag;
}

function environmentCommit(environment: NodeJS.ProcessEnv): string | null {
  const value = environment.TRANSITMAPPER_BUILD_COMMIT ?? environment.GITHUB_SHA;
  if (!value) return null;
  if (!FULL_GIT_SHA.test(value)) throw new Error(`build commit is not a full Git SHA: ${value}`);
  return value.toLowerCase();
}

function environmentDirty(environment: NodeJS.ProcessEnv): boolean | null {
  const value = environment.TRANSITMAPPER_BUILD_DIRTY;
  if (value === undefined) return null;
  if (value === '0') return false;
  if (value === '1') return true;
  throw new Error(`TRANSITMAPPER_BUILD_DIRTY must be 0 or 1; received ${value}`);
}

function samplingEnabled(environment: NodeJS.ProcessEnv): boolean {
  const value = environment.TRANSITMAPPER_PERFORMANCE_SAMPLING_ENABLED;
  if (value === undefined || value === '1') return true;
  if (value === '0') return false;
  throw new Error('TRANSITMAPPER_PERFORMANCE_SAMPLING_ENABLED must be 0 or 1');
}

function samplingBasisPoints(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${name} must be an integer from 0 to 10000`);
  }
  return value;
}

function performanceSampling(
  environment: NodeJS.ProcessEnv,
  releaseTag: string | null,
  now: Date,
): BuildInfo['performanceSampling'] {
  return {
    enabled: samplingEnabled(environment),
    ordinaryBasisPoints: samplingBasisPoints(
      environment,
      'TRANSITMAPPER_PERFORMANCE_ORDINARY_BASIS_POINTS',
      100,
    ),
    releaseBasisPoints: samplingBasisPoints(
      environment,
      'TRANSITMAPPER_PERFORMANCE_RELEASE_BASIS_POINTS',
      500,
    ),
    boostUntil: releaseTag ? new Date(now.getTime() + DAY_MS).toISOString() : null,
  };
}

export function readGitBuildState(repositoryRoot: string): GitBuildState | null {
  try {
    const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!FULL_GIT_SHA.test(commitSha)) return null;

    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { commitSha: commitSha.toLowerCase(), dirty: status.trim().length > 0 };
  } catch {
    return null;
  }
}

/** Make the Git identity visible before Turbo computes its cache key. The
 * timestamp is deliberately absent: a cache hit restores an artifact whose
 * embedded time truthfully remains when that artifact was first produced. */
export function buildEnvironment(
  environment: NodeJS.ProcessEnv,
  git: GitBuildState | null,
): NodeJS.ProcessEnv {
  const commitSha = environmentCommit(environment) ?? git?.commitSha ?? '';
  const dirty = environmentDirty(environment) ?? git?.dirty ?? false;
  return {
    ...environment,
    TRANSITMAPPER_BUILD_COMMIT: commitSha,
    TRANSITMAPPER_BUILD_DIRTY: dirty ? '1' : '0',
  };
}

export function loadBuildInfo({
  repositoryRoot,
  environment = process.env,
  git = readGitBuildState(repositoryRoot),
  now = new Date(),
}: LoadBuildInfoOptions): BuildInfo {
  const manifest = JSON.parse(
    readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
  ) as PackageManifest;
  const version = packageVersion(manifest);
  const repository = repositoryUrl(manifest.repository);
  const commitSha = environmentCommit(environment) ?? git?.commitSha ?? null;
  const dirty = environmentDirty(environment) ?? git?.dirty ?? false;
  const releaseTag = releaseTagFor(environment, version);

  return {
    version,
    repositoryUrl: repository,
    commitSha,
    commitUrl: commitSha ? `${repository}/commit/${commitSha}` : null,
    builtAt: now.toISOString(),
    dirty,
    copyrightNotice: copyrightNotice(readFileSync(resolve(repositoryRoot, 'LICENSE'), 'utf8')),
    releaseTag,
    releaseUrl: releaseTag ? `${repository}/releases/tag/${releaseTag}` : null,
    attestationsUrl: `${repository}/attestations`,
    performanceSampling: performanceSampling(environment, releaseTag, now),
  };
}
