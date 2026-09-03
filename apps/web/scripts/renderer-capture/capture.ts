import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, type Browser } from 'playwright-core';
import {
  buildPerformanceApp,
  startPreview,
  stopPreview,
  type RunningPreview,
} from '../perf/process';
import {
  RENDERER_CAPTURE_ARTIFACT_ROOT,
  rendererCaptureIsComplete,
  type RendererCaptureCliOptions,
} from './cli';
import { configureRendererCaptureBaseUrl } from './capture-browser';
import { captureContextEvidence } from './capture-contexts';
import { buildRendererContactSheet } from './capture-contact-sheet';
import {
  captureEditorMatrix,
  captureFractionalFilmstrips,
  captureReferenceFixtures,
} from './capture-scenes';
import type { RendererCaptureManifest, RendererCaptureManifestEntry } from './capture-types';
import { captureRendererLodAcceptance } from './lod-acceptance-runner';
import {
  prepareRendererCaptureOutput,
  rendererCaptureDigest,
  rendererSourceContentDigest,
  rendererSourceIsDirty,
} from './lifecycle';

const execFileAsync = promisify(execFile);

const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

async function gitOutput(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  return stdout;
}

async function sourceProvenance(): Promise<RendererCaptureManifest['source']> {
  const [revisionOutput, status, trackedDiff, untrackedOutput] = await Promise.all([
    gitOutput(['rev-parse', 'HEAD']),
    gitOutput(['status', '--porcelain', '--untracked-files=normal']),
    gitOutput(['diff', '--binary', '--full-index', '--no-ext-diff', 'HEAD', '--']),
    gitOutput(['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const revision = revisionOutput.trim();
  const untrackedFiles = await Promise.all(
    untrackedOutput
      .split('\0')
      .filter((path) => path.length > 0)
      .map(async (path) => ({ path, bytes: await readFile(resolve(path)) })),
  );
  return {
    revision,
    dirty: rendererSourceIsDirty(status),
    contentSha256: rendererSourceContentDigest(revision, Buffer.from(trackedDiff), untrackedFiles),
  };
}

async function hashCaptureFiles(
  outputDirectory: string,
  entries: readonly RendererCaptureManifestEntry[],
): Promise<RendererCaptureManifestEntry[]> {
  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      sha256: rendererCaptureDigest(await readFile(resolve(outputDirectory, entry.file))),
    })),
  );
}

async function captureEvidence(
  browser: Browser,
  options: RendererCaptureCliOptions,
): Promise<RendererCaptureManifestEntry[]> {
  const imageDirectory = resolve(options.outputDirectory, 'images');
  // A named fixture selection is the fast diagnostic path: one picture of the
  // scene under review rather than the sixty-odd of the full evidence plan.
  if (options.fixtures.length > 0) {
    return captureReferenceFixtures(browser, imageDirectory, options.phase, options.fixtures);
  }
  const entries = await captureEditorMatrix(browser, options, imageDirectory);
  if (options.profile !== 'all' || options.theme !== 'all') return entries;
  entries.push(
    ...(await captureFractionalFilmstrips(browser, imageDirectory, options.phase)),
    ...(await captureReferenceFixtures(browser, imageDirectory, options.phase)),
    ...(await captureContextEvidence(browser, imageDirectory, options.phase)),
  );
  return entries;
}

async function writeCaptureFailure(
  options: RendererCaptureCliOptions,
  error: unknown,
): Promise<void> {
  await writeFile(
    resolve(options.outputDirectory, 'capture-error.json'),
    `${JSON.stringify(
      {
        phase: options.phase,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

export async function runRendererCapture(options: RendererCaptureCliOptions): Promise<void> {
  let preview: RunningPreview | undefined;
  let browser: Browser | undefined;
  const source = await sourceProvenance();
  await prepareRendererCaptureOutput(options.outputDirectory, RENDERER_CAPTURE_ARTIFACT_ROOT);
  try {
    if (!options.skipBuild) await buildPerformanceApp();
    preview = await startPreview('instrumented');
    configureRendererCaptureBaseUrl(preview.url);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const entries = await hashCaptureFiles(
      options.outputDirectory,
      await captureEvidence(browser, options),
    );
    const complete = rendererCaptureIsComplete(options);
    const lodAcceptance =
      options.phase === '01-lod' && complete
        ? await captureRendererLodAcceptance(browser, options.outputDirectory, source)
        : undefined;
    const manifest: RendererCaptureManifest = {
      schemaVersion: 1,
      phase: options.phase,
      complete,
      selection: { profile: options.profile, theme: options.theme },
      generatedAt: new Date().toISOString(),
      source,
      basemap: 'local-blank-v2',
      captures: entries,
    };
    await writeFile(
      resolve(options.outputDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await buildRendererContactSheet(options, entries, lodAcceptance);
    console.log(`renderer captures: ${options.outputDirectory}`);
  } catch (error) {
    await writeCaptureFailure(options, error);
    throw error;
  } finally {
    await browser?.close();
    await stopPreview(preview);
    configureRendererCaptureBaseUrl(null);
  }
}
