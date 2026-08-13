#!/usr/bin/env tsx

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE_BUDGETS } from '../../perf.config';
import { evaluateBundleBudgets } from '../../src/perf/bundleBudget';
import {
  evaluateChunkSizes,
  isMapEngineChunkName,
  performanceChunkKind,
  type PerformanceChunkSize,
} from '../../src/perf/chunkPolicy';
import {
  createDeliveryGraphs,
  type BundleGraphReport,
  type BundleReport,
  type ViteManifest,
} from './bundle-report';

export { compareBundleReports, createDeliveryGraphs } from './bundle-report';
export type {
  BundleEntryReport,
  BundleFileChange,
  BundleFileReport,
  BundleGraphReport,
  BundleReport,
  BundleReportComparison,
  CreateDeliveryGraphsOptions,
  DeliveryGraphs,
  ViteManifest,
  ViteManifestEntry,
} from './bundle-report';

interface SourceMap {
  sources?: unknown;
}

const APP_ROOT = resolve(import.meta.dirname, '../..');
const DIST_DIRECTORY = resolve(APP_ROOT, 'dist');
const MANIFEST_PATH = resolve(DIST_DIRECTORY, '.vite/manifest.json');
const REPORT_PATH = resolve(DIST_DIRECTORY, 'performance/bundle-report.json');

async function outputFiles(): Promise<Record<string, Uint8Array>> {
  const directoryEntries = await readdir(DIST_DIRECTORY, {
    recursive: true,
    withFileTypes: true,
  });
  const paths = directoryEntries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(DIST_DIRECTORY, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'),
    )
    .filter(
      (path) =>
        !path.endsWith('.map') &&
        path !== '.vite/manifest.json' &&
        !path.startsWith('performance/'),
    )
    .sort();
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [path, await readFile(resolve(DIST_DIRECTORY, path))] as const),
    ),
  );
}

async function reportChunks(): Promise<PerformanceChunkSize[]> {
  const directoryEntries = await readdir(DIST_DIRECTORY, {
    recursive: true,
    withFileTypes: true,
  });
  const files = directoryEntries
    .filter((entry) => entry.isFile() && /\.(?:m?js)$/.test(entry.name))
    .map((entry) =>
      relative(DIST_DIRECTORY, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/'),
    )
    .sort();
  return Promise.all(
    files.map(async (file) => {
      let moduleIds: string[] = [];
      if (isMapEngineChunkName(file)) {
        try {
          const sourceMap = JSON.parse(
            await readFile(resolve(DIST_DIRECTORY, `${file}.map`), 'utf8'),
          ) as SourceMap;
          moduleIds = Array.isArray(sourceMap.sources)
            ? sourceMap.sources.filter((source): source is string => typeof source === 'string')
            : [];
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      return {
        file,
        rawBytes: (await stat(resolve(DIST_DIRECTORY, file))).size,
        kind: performanceChunkKind(file, moduleIds),
      };
    }),
  );
}

function formatKiB(bytes: number): string {
  return `${(bytes / 1_024).toFixed(1)} KiB`;
}

function logGraph(label: string, graph: BundleGraphReport): void {
  console.log(
    `${label}: raw ${formatKiB(graph.rawBytes)}, ` +
      `gzip ${formatKiB(graph.gzipBytes)}, brotli ${formatKiB(graph.brotliBytes)}`,
  );
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as ViteManifest;
  const graphs = createDeliveryGraphs({ manifest, files: await outputFiles() });
  const chunks = await reportChunks();
  const violations = evaluateBundleBudgets(graphs.entries, BUNDLE_BUDGETS);
  const chunkViolations = evaluateChunkSizes(chunks);
  const report: BundleReport = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    ...graphs,
    chunks,
    violations,
    chunkViolations,
  };
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  for (const entry of report.entries) {
    logGraph(`bundle ${entry.entry} eager`, entry.eager);
    logGraph(`bundle ${entry.entry} lazy`, entry.lazy);
    logGraph(`bundle ${entry.entry} complete`, entry.complete);
  }
  logGraph('dedicated Workers', report.workers);
  logGraph('service Worker', report.serviceWorker);
  logGraph('install assets', report.installAssets);
  logGraph('precache union', report.precache);
  const largestChunk = [...chunks].sort((left, right) => right.rawBytes - left.rawBytes).at(0);
  if (largestChunk) {
    console.log(
      `largest JavaScript chunk: ${largestChunk.file} (${formatKiB(largestChunk.rawBytes)})`,
    );
  }
  console.log(`bundle report: ${REPORT_PATH}`);
  for (const violation of violations) console.error(`bundle budget: ${violation.message}`);
  for (const violation of chunkViolations) console.error(`chunk budget: ${violation.message}`);
  if (violations.length > 0 || chunkViolations.length > 0) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`bundle report unavailable: ${message}`);
    process.exitCode = 1;
  });
}
