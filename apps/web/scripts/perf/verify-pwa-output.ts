#!/usr/bin/env tsx

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  editorAdaptiveFiles,
  editorOfflinePrecacheFiles,
  editorPrecacheFiles,
  embedOnlyFiles,
  manifestInstallIconFiles,
  referencedBuildAssetFiles,
  verifyPrecacheOutput,
  type BuildManifest,
  type WebAppManifest,
} from '../../src/perf/pwaPrecache';
import {
  ADAPTIVE_CACHE_NAME,
  parseAdaptiveAssetManifest,
} from '../../src/pwa/adaptive-cache-contract';

interface PwaOutputReport {
  schemaVersion: 2;
  generatedAt: string;
  expectedEssentialAssets: string[];
  adaptiveAssets: string[];
  precachedAssets: string[];
  adaptiveCacheName: string;
  excludedEmbedAssets: string[];
  navigationFallbackDenylist: string[];
  failures: string[];
}

const APP_ROOT = resolve(import.meta.dirname, '../..');
const DIST_DIRECTORY = resolve(APP_ROOT, 'dist');
const MANIFEST_PATH = resolve(DIST_DIRECTORY, '.vite/manifest.json');
const WEB_APP_MANIFEST_PATH = resolve(DIST_DIRECTORY, 'manifest.json');
const SERVICE_WORKER_PATH = resolve(DIST_DIRECTORY, 'sw.js');
const ADAPTIVE_MANIFEST_PATH = resolve(DIST_DIRECTORY, 'adaptive-assets.json');
const REPORT_PATH = resolve(DIST_DIRECTORY, 'performance/pwa-report.json');
const NAVIGATION_FALLBACK_DENYLIST = ['/api/', '/s/', '/e/', '/v/', '/embed/'] as const;

function precacheUrls(serviceWorker: string): string[] {
  return [...serviceWorker.matchAll(/\burl:"([^"]+)"/g)].map((match) => match[1]).sort();
}

function denylistLiteral(prefix: string): string {
  return `/^\\/${prefix.slice(1, -1)}\\//`;
}

async function referencedBuildAssets(initialFiles: string[]): Promise<string[]> {
  const discovered = new Set(initialFiles);
  const pending = initialFiles.filter((file) => file.endsWith('.js') || file.endsWith('.css'));

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file) continue;
    const source = await readFile(resolve(DIST_DIRECTORY, file), 'utf8');
    for (const referenced of referencedBuildAssetFiles(source)) {
      if (discovered.has(referenced)) continue;
      discovered.add(referenced);
      if (referenced.endsWith('.js') || referenced.endsWith('.css')) {
        pending.push(referenced);
      }
    }
  }

  return [...discovered].sort();
}

async function adaptiveManifestFailures(
  expected: readonly string[],
  actual: readonly { url: string; bytes: number }[],
  precached: readonly string[],
): Promise<string[]> {
  const failures: string[] = [];
  const actualFiles = actual.map((asset) => asset.url.replace(/^\/+/, ''));
  if (JSON.stringify(actualFiles) !== JSON.stringify(expected)) {
    failures.push('adaptive asset manifest does not match the optional editor graph');
  }
  const precacheSet = new Set(precached);
  failures.push(
    ...expected
      .filter((file) => precacheSet.has(file))
      .map((file) => `adaptive editor asset is precached during first install: ${file}`),
  );
  for (const asset of actual) {
    const file = asset.url.replace(/^\/+/, '');
    if ((await stat(resolve(DIST_DIRECTORY, file))).size !== asset.bytes) {
      failures.push(`adaptive asset size is stale: ${file}`);
    }
  }
  return failures;
}

function serviceWorkerPolicyFailures(serviceWorker: string): string[] {
  const failures: string[] = [];
  if (!serviceWorker.includes(ADAPTIVE_CACHE_NAME) || !serviceWorker.includes('CacheFirst')) {
    failures.push('adaptive runtime CacheFirst route is missing');
  }
  for (const prefix of NAVIGATION_FALLBACK_DENYLIST) {
    if (!serviceWorker.includes(denylistLiteral(prefix))) {
      failures.push(`navigation fallback is not denied for ${prefix}`);
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as BuildManifest;
  const webAppManifest = JSON.parse(
    await readFile(WEB_APP_MANIFEST_PATH, 'utf8'),
  ) as WebAppManifest;
  const installIcons = manifestInstallIconFiles(webAppManifest);
  const serviceWorker = await readFile(SERVICE_WORKER_PATH, 'utf8');
  const eagerEditorAssets = editorPrecacheFiles(manifest, installIcons);
  const candidateEditorAssets = await referencedBuildAssets([
    ...eagerEditorAssets,
    ...editorAdaptiveFiles(manifest, installIcons),
  ]);
  const expectedEssentialAssets = editorOfflinePrecacheFiles(
    manifest,
    installIcons,
    candidateEditorAssets,
  );
  const completeEditorAssets = await referencedBuildAssets([
    ...expectedEssentialAssets,
    ...editorAdaptiveFiles(manifest, installIcons, candidateEditorAssets),
  ]);
  const essentialSet = new Set(expectedEssentialAssets);
  const expectedAdaptiveAssets = completeEditorAssets.filter((file) => !essentialSet.has(file));
  const adaptiveManifest = parseAdaptiveAssetManifest(
    JSON.parse(await readFile(ADAPTIVE_MANIFEST_PATH, 'utf8')),
  );
  const adaptiveAssets = adaptiveManifest.assets.map((asset) => asset.url.replace(/^\/+/, ''));
  const precachedAssets = precacheUrls(serviceWorker);
  const failures = verifyPrecacheOutput({
    manifest,
    installIcons,
    precached: precachedAssets,
    offlineRuntimeFiles: candidateEditorAssets,
  });

  failures.push(
    ...(await adaptiveManifestFailures(
      expectedAdaptiveAssets,
      adaptiveManifest.assets,
      precachedAssets,
    )),
    ...serviceWorkerPolicyFailures(serviceWorker),
  );

  const report: PwaOutputReport = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    expectedEssentialAssets,
    adaptiveAssets,
    precachedAssets,
    adaptiveCacheName: ADAPTIVE_CACHE_NAME,
    excludedEmbedAssets: embedOnlyFiles(manifest, installIcons),
    navigationFallbackDenylist: [...NAVIGATION_FALLBACK_DENYLIST],
    failures,
  };

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (failures.length > 0) {
    for (const failure of failures) console.error(`PWA output: ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `PWA output: ${expectedEssentialAssets.length} essential assets precached; ` +
      `${adaptiveAssets.length} adaptive and ${report.excludedEmbedAssets.length} embed-only ` +
      'assets excluded.',
  );
  console.log(`PWA report: ${REPORT_PATH}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PWA output unavailable: ${message}`);
  process.exitCode = 1;
});
