#!/usr/bin/env tsx

import { brotliCompressSync, gzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { BUNDLE_BUDGETS } from '../../perf.config';
import {
  evaluateBundleBudgets,
  type BundleBudgetViolation,
  type BundleEntrySize,
} from '../../src/perf/bundleBudget';
import {
  evaluateChunkSizes,
  isMapEngineChunkName,
  performanceChunkKind,
  type PerformanceChunkSize,
  type PerformanceChunkViolation,
} from '../../src/perf/chunkPolicy';

interface ViteManifestEntry {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}

type ViteManifest = Record<string, ViteManifestEntry>;

interface BundleEntryReport extends BundleEntrySize {
  files: string[];
}

interface BundleReport {
  schemaVersion: 2;
  generatedAt: string;
  entries: BundleEntryReport[];
  chunks: PerformanceChunkSize[];
  violations: BundleBudgetViolation[];
  chunkViolations: PerformanceChunkViolation[];
}

interface SourceMap {
  sources?: unknown;
}

const APP_ROOT = resolve(import.meta.dirname, '../..');
const DIST_DIRECTORY = resolve(APP_ROOT, 'dist');
const MANIFEST_PATH = resolve(DIST_DIRECTORY, '.vite/manifest.json');
const REPORT_PATH = resolve(DIST_DIRECTORY, 'performance/bundle-report.json');

function entryName(key: string, entry: ViteManifestEntry): string {
  if (entry.name) return entry.name;
  const source = entry.src ?? key;
  return basename(source).replace(/\.[^.]+$/, '') === 'index'
    ? 'main'
    : basename(source).replace(/\.[^.]+$/, '');
}

function collectFiles(
  key: string,
  manifest: ViteManifest,
  collected: Set<string>,
  visited: Set<string>,
): void {
  if (visited.has(key)) return;
  visited.add(key);
  const entry = manifest[key];
  if (!entry) throw new Error(`Vite manifest import "${key}" does not exist.`);
  collected.add(entry.file);
  for (const file of entry.css ?? []) collected.add(file);
  for (const file of entry.assets ?? []) collected.add(file);
  for (const importedKey of [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]) {
    collectFiles(importedKey, manifest, collected, visited);
  }
}

async function sizeFiles(files: string[]): Promise<Omit<BundleEntrySize, 'entry'>> {
  let rawBytes = 0;
  let gzipBytes = 0;
  let brotliBytes = 0;

  for (const file of files) {
    const contents = await readFile(resolve(DIST_DIRECTORY, file));
    rawBytes += contents.byteLength;
    gzipBytes += gzipSync(contents).byteLength;
    brotliBytes += brotliCompressSync(contents).byteLength;
  }

  return { rawBytes, gzipBytes, brotliBytes };
}

async function reportEntry(
  key: string,
  entry: ViteManifestEntry,
  manifest: ViteManifest,
): Promise<BundleEntryReport> {
  const files = new Set<string>();
  collectFiles(key, manifest, files, new Set());
  if (key.endsWith('.html')) files.add(key);
  const sortedFiles = [...files].sort();

  return {
    entry: entryName(key, entry),
    files: sortedFiles,
    ...(await sizeFiles(sortedFiles)),
  };
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

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as ViteManifest;
  const entries = await Promise.all(
    Object.entries(manifest)
      .filter(([, entry]) => entry.isEntry)
      .map(([key, entry]) => reportEntry(key, entry, manifest)),
  );
  const chunks = await reportChunks();
  const violations = evaluateBundleBudgets(entries, BUNDLE_BUDGETS);
  const chunkViolations = evaluateChunkSizes(chunks);
  const report: BundleReport = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    entries,
    chunks,
    violations,
    chunkViolations,
  };

  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  for (const entry of entries) {
    console.log(
      `bundle ${entry.entry}: raw ${formatKiB(entry.rawBytes)}, ` +
        `gzip ${formatKiB(entry.gzipBytes)}, brotli ${formatKiB(entry.brotliBytes)}`,
    );
  }
  const largestChunk = [...chunks].sort((left, right) => right.rawBytes - left.rawBytes)[0];
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`bundle report unavailable: ${message}`);
  process.exitCode = 1;
});
