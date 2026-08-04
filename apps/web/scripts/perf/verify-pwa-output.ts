#!/usr/bin/env tsx

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  editorPrecacheFiles,
  embedOnlyFiles,
  manifestInstallIconFiles,
  referencedBuildAssetFiles,
  verifyPrecacheOutput,
  type BuildManifest,
  type WebAppManifest,
} from '../../src/perf/pwaPrecache';

interface PwaOutputReport {
  schemaVersion: 1;
  generatedAt: string;
  expectedEditorAssets: string[];
  precachedAssets: string[];
  excludedEmbedAssets: string[];
  navigationFallbackDenylist: string[];
  failures: string[];
}

const APP_ROOT = resolve(import.meta.dirname, '../..');
const DIST_DIRECTORY = resolve(APP_ROOT, 'dist');
const MANIFEST_PATH = resolve(DIST_DIRECTORY, '.vite/manifest.json');
const WEB_APP_MANIFEST_PATH = resolve(DIST_DIRECTORY, 'manifest.json');
const SERVICE_WORKER_PATH = resolve(DIST_DIRECTORY, 'sw.js');
const REPORT_PATH = resolve(DIST_DIRECTORY, 'performance/pwa-report.json');
const NAVIGATION_FALLBACK_DENYLIST = ['/api/', '/s/', '/e/'] as const;

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

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as BuildManifest;
  const webAppManifest = JSON.parse(
    await readFile(WEB_APP_MANIFEST_PATH, 'utf8'),
  ) as WebAppManifest;
  const installIcons = manifestInstallIconFiles(webAppManifest);
  const serviceWorker = await readFile(SERVICE_WORKER_PATH, 'utf8');
  const expectedEditorAssets = await referencedBuildAssets(
    editorPrecacheFiles(manifest, installIcons),
  );
  const precachedAssets = precacheUrls(serviceWorker);
  const failures = verifyPrecacheOutput({
    manifest,
    installIcons,
    precached: precachedAssets,
  });

  for (const file of expectedEditorAssets) {
    if (!precachedAssets.includes(file)) {
      const failure = `editor-referenced asset is not precached: ${file}`;
      if (!failures.includes(failure)) failures.push(failure);
    }
  }

  for (const prefix of NAVIGATION_FALLBACK_DENYLIST) {
    if (!serviceWorker.includes(denylistLiteral(prefix))) {
      failures.push(`navigation fallback is not denied for ${prefix}`);
    }
  }

  const report: PwaOutputReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    expectedEditorAssets,
    precachedAssets,
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
    `PWA output: ${expectedEditorAssets.length} editor assets precached; ` +
      `${report.excludedEmbedAssets.length} embed-only assets excluded.`,
  );
  console.log(`PWA report: ${REPORT_PATH}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PWA output unavailable: ${message}`);
  process.exitCode = 1;
});
