import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { createPerfProtocol, PERF_DEFAULT_ARTIFACT_DIRECTORY } from '../../perf.config';
import { createPerfReport } from '../../src/perf/report';
import type { PerfProfileId, PerfReport } from '../../src/perf/types';
import {
  checkedBaselinePath,
  copyBuildReports,
  freezeCheckedBaseline,
  readBundleEntries,
  writeReport,
} from './artifacts';
import { allocateChromeDebuggingPort, chromeDebuggingArgument } from './flat-cdp-connection';
import { runFirstSessionMatrix } from './first-session-matrix';
import { createLegacy497a549FirstSessionSurfaceRunner } from './playwright-first-session';
import { APP_ROOT, startPreview, stopPreview, type RunningPreview } from './process';

export const LEGACY_BASELINE_REVISION = '497a549';
export const LEGACY_BASELINE_MARK_SOURCE = 'legacy-497a549-observer-v1' as const;

export interface LegacyBaselineArtifactPaths {
  appRoot: string;
  outputDirectory: string;
  embedHtmlPath: string;
}

export interface RunLegacy497a549BaselineOptions {
  profile?: PerfProfileId;
  outputDirectory?: string;
}

export function legacyBaselineArtifactPaths(worktreeRoot: string): LegacyBaselineArtifactPaths {
  const appRoot = resolve(worktreeRoot, 'apps/web');
  const outputDirectory = resolve(appRoot, 'dist');
  return {
    appRoot,
    outputDirectory,
    embedHtmlPath: resolve(outputDirectory, 'embed.html'),
  };
}

function repositoryRoot(): string {
  return resolve(APP_ROOT, '../..');
}

function timestampedOutputDirectory(profile: PerfProfileId): string {
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  return resolve(APP_ROOT, PERF_DEFAULT_ARTIFACT_DIRECTORY, 'legacy-497a549', profile, timestamp);
}

function commandError(command: string, code: number | null, output: string): Error {
  const detail = output.trim();
  return new Error(`${command} exited with ${code ?? 'no status'}${detail ? `:\n${detail}` : '.'}`);
}

async function runCommand(cwd: string, command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(commandError([command, ...args].join(' '), code, output));
    });
  });
}

async function assertMissing(path: string): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`The immutable baseline already exists at ${path}.`);
}

async function assertLegacyBuild(paths: LegacyBaselineArtifactPaths): Promise<void> {
  await Promise.all([
    access(resolve(paths.outputDirectory, 'index.html')),
    access(paths.embedHtmlPath),
  ]);
}

async function buildLegacyArtifact(worktreeRoot: string): Promise<void> {
  await runCommand(worktreeRoot, 'pnpm', ['install', '--frozen-lockfile']);
  await runCommand(worktreeRoot, 'pnpm', ['--filter', '@transitmapper/web', 'build']);
}

async function addLegacyWorktree(worktreeRoot: string): Promise<void> {
  await runCommand(repositoryRoot(), 'git', [
    'worktree',
    'add',
    '--detach',
    worktreeRoot,
    LEGACY_BASELINE_REVISION,
  ]);
}

async function removeLegacyWorktree(worktreeRoot: string): Promise<void> {
  try {
    await runCommand(repositoryRoot(), 'git', ['worktree', 'remove', '--force', worktreeRoot]);
  } catch (error) {
    // The enclosing temporary directory is still removed. Preserve the actual
    // measurement/build failure instead of replacing it with cleanup noise.
    console.warn(`Could not unregister temporary legacy worktree: ${String(error)}`);
  }
}

function createLegacyReport(
  profile: PerfProfileId,
  bundles: Awaited<ReturnType<typeof readBundleEntries>>,
  firstSessions: Awaited<ReturnType<typeof runFirstSessionMatrix>>,
): PerfReport {
  return createPerfReport({
    generatedAt: new Date().toISOString(),
    protocol: createPerfProtocol(profile),
    provenance: {
      artifactRevision: LEGACY_BASELINE_REVISION,
      milestoneMarkSource: LEGACY_BASELINE_MARK_SOURCE,
    },
    scenarios: [],
    samples: [],
    bundles,
    firstSessions,
  });
}

/**
 * Build and measure the exact pre-program revision with the current CDP
 * ledger. The observer adapter adds User Timing marks only; it cannot alter
 * requests, bytes, or the legacy application's source files.
 */
export async function runLegacy497a549Baseline(
  options: RunLegacy497a549BaselineOptions = {},
): Promise<string> {
  const profile = options.profile ?? 'desktop';
  const baselinePath = checkedBaselinePath(profile);
  await assertMissing(baselinePath);
  await assertMissing(`${baselinePath}.sha256`);

  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'transitmapper-497a549-'));
  const worktreeRoot = resolve(temporaryRoot, 'source');
  const artifact = legacyBaselineArtifactPaths(worktreeRoot);
  const outputDirectory = options.outputDirectory ?? timestampedOutputDirectory(profile);
  let worktreeAdded = false;
  let preview: RunningPreview | undefined;
  let browser: Browser | undefined;
  try {
    await addLegacyWorktree(worktreeRoot);
    worktreeAdded = true;
    await buildLegacyArtifact(worktreeRoot);
    await assertLegacyBuild(artifact);
    await copyBuildReports(outputDirectory, resolve(artifact.outputDirectory, 'performance'));

    const protocol = createPerfProtocol(profile);
    const debuggingPort = await allocateChromeDebuggingPort();
    preview = await startPreview('public', {
      cwd: artifact.appRoot,
      outputDirectory: artifact.outputDirectory,
    });
    browser = await chromium.launch({
      channel: protocol.browserChannel,
      headless: false,
      args: [chromeDebuggingArgument(debuggingPort)],
    });
    const firstSessions = await runFirstSessionMatrix(
      createLegacy497a549FirstSessionSurfaceRunner({
        browser,
        protocol,
        previewUrl: preview.url,
        debuggingPort,
        embedHtmlPath: artifact.embedHtmlPath,
      }),
    );
    const bundles = await readBundleEntries(
      resolve(artifact.outputDirectory, 'performance/bundle-report.json'),
    );
    const report = createLegacyReport(profile, bundles, firstSessions);
    const reportPath = await writeReport(outputDirectory, report);
    await freezeCheckedBaseline(baselinePath, report);
    console.log(`legacy ${LEGACY_BASELINE_REVISION} baseline frozen: ${baselinePath}`);
    console.log(`legacy baseline report: ${reportPath}`);
    return reportPath;
  } finally {
    await browser?.close();
    await stopPreview(preview);
    if (worktreeAdded) await removeLegacyWorktree(worktreeRoot);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
