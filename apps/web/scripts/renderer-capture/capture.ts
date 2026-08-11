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
import { RENDERER_CAPTURE_ARTIFACT_ROOT, type RendererCaptureCliOptions } from './cli';
import { captureContextEvidence } from './capture-contexts';
import { buildRendererContactSheet } from './capture-contact-sheet';
import {
  captureEditorMatrix,
  captureFractionalFilmstrips,
  captureReferenceFixtures,
} from './capture-scenes';
import type { RendererCaptureManifest, RendererCaptureManifestEntry } from './capture-types';
import {
  prepareRendererCaptureOutput,
  rendererCaptureDigest,
  rendererSourceIsDirty,
} from './lifecycle';

const execFileAsync = promisify(execFile);

async function sourceProvenance(): Promise<RendererCaptureManifest['source']> {
  const [{ stdout: revision }, { stdout: status }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD']),
    execFileAsync('git', ['status', '--porcelain', '--untracked-files=normal']),
  ]);
  return { revision: revision.trim(), dirty: rendererSourceIsDirty(status) };
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
    preview = await startPreview();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const entries = await hashCaptureFiles(
      options.outputDirectory,
      await captureEvidence(browser, options),
    );
    const manifest: RendererCaptureManifest = {
      schemaVersion: 1,
      phase: options.phase,
      complete: options.profile === 'all' && options.theme === 'all',
      selection: { profile: options.profile, theme: options.theme },
      generatedAt: new Date().toISOString(),
      source,
      basemap: 'local-blank-v1',
      captures: entries,
    };
    await writeFile(
      resolve(options.outputDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await buildRendererContactSheet(options, entries);
    console.log(`renderer captures: ${options.outputDirectory}`);
  } catch (error) {
    await writeCaptureFailure(options, error);
    throw error;
  } finally {
    await browser?.close();
    await stopPreview(preview);
  }
}
