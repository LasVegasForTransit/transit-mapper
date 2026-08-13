import { createHash } from 'node:crypto';
import { basename, posix } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import type { BundleBudgetViolation, BundleEntrySize } from '../../src/perf/bundleBudget';
import type { PerformanceChunkSize, PerformanceChunkViolation } from '../../src/perf/chunkPolicy';

export interface ViteManifestEntry {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}

export type ViteManifest = Partial<Record<string, ViteManifestEntry>>;

export interface BundleFileReport {
  path: string;
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
  digest: string;
}

export interface BundleGraphReport {
  files: BundleFileReport[];
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}

export interface BundleEntryReport extends BundleEntrySize {
  eager: BundleGraphReport;
  lazy: BundleGraphReport;
  complete: BundleGraphReport;
}

export interface DeliveryGraphs {
  entries: BundleEntryReport[];
  workers: BundleGraphReport;
  serviceWorker: BundleGraphReport;
  installAssets: BundleGraphReport;
  precache: BundleGraphReport;
}

export interface BundleReport extends DeliveryGraphs {
  schemaVersion: 3;
  generatedAt: string;
  chunks: PerformanceChunkSize[];
  violations: BundleBudgetViolation[];
  chunkViolations: PerformanceChunkViolation[];
}

export interface BundleFileChange {
  path: string;
  before: BundleFileReport;
  after: BundleFileReport;
}

export interface BundleReportComparison {
  added: BundleFileReport[];
  removed: BundleFileReport[];
  changed: BundleFileChange[];
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}

export interface CreateDeliveryGraphsOptions {
  manifest: ViteManifest;
  files: Readonly<Partial<Record<string, Uint8Array>>>;
  serviceWorkerPath?: string;
}

interface ManifestTraversal {
  manifest: ViteManifest;
  includeDynamicImports: boolean;
  collected: Set<string>;
  visited: Set<string>;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function entryName(key: string, entry: ViteManifestEntry): string {
  if (entry.name) return entry.name;
  const source = entry.src ?? key;
  return basename(source).replace(/\.[^.]+$/, '') === 'index'
    ? 'main'
    : basename(source).replace(/\.[^.]+$/, '');
}

function collectManifestFiles(key: string, traversal: ManifestTraversal): void {
  if (traversal.visited.has(key)) return;
  traversal.visited.add(key);
  const entry = traversal.manifest[key];
  if (!entry) throw new Error(`Vite manifest import "${key}" does not exist.`);
  traversal.collected.add(entry.file);
  for (const file of entry.css ?? []) traversal.collected.add(file);
  for (const file of entry.assets ?? []) traversal.collected.add(file);
  const imports = traversal.includeDynamicImports
    ? [...(entry.imports ?? []), ...(entry.dynamicImports ?? [])]
    : (entry.imports ?? []);
  for (const importedKey of imports) collectManifestFiles(importedKey, traversal);
}

function manifestEntryFiles(
  key: string,
  manifest: ViteManifest,
  includeDynamicImports: boolean,
): Set<string> {
  const collected = new Set<string>();
  collectManifestFiles(key, {
    manifest,
    includeDynamicImports,
    collected,
    visited: new Set(),
  });
  if (key.endsWith('.html')) collected.add(key);
  return collected;
}

function fileReport(
  path: string,
  files: Readonly<Partial<Record<string, Uint8Array>>>,
): BundleFileReport {
  const contents = files[path];
  if (!contents) throw new Error(`Build output "${path}" does not exist.`);
  return {
    path,
    rawBytes: contents.byteLength,
    gzipBytes: gzipSync(contents).byteLength,
    brotliBytes: brotliCompressSync(contents).byteLength,
    digest: `sha256:${createHash('sha256').update(contents).digest('hex')}`,
  };
}

function graphReport(
  paths: Iterable<string>,
  files: Readonly<Partial<Record<string, Uint8Array>>>,
): BundleGraphReport {
  const reports = [...new Set(paths)].sort().map((path) => fileReport(path, files));
  return {
    files: reports,
    rawBytes: reports.reduce((total, file) => total + file.rawBytes, 0),
    gzipBytes: reports.reduce((total, file) => total + file.gzipBytes, 0),
    brotliBytes: reports.reduce((total, file) => total + file.brotliBytes, 0),
  };
}

function emittedSource(path: string, files: Readonly<Partial<Record<string, Uint8Array>>>): string {
  const contents = files[path];
  if (!contents) throw new Error(`Build output "${path}" does not exist.`);
  return Buffer.from(contents).toString('utf8');
}

function resolvedOutputReference(
  reference: string,
  ownerPath: string,
  files: Readonly<Partial<Record<string, Uint8Array>>>,
): string {
  const withoutQuery = reference.split(/[?#]/, 1)[0];
  const path = withoutQuery.startsWith('/')
    ? withoutQuery.replace(/^\/+/, '')
    : posix.normalize(posix.join(posix.dirname(ownerPath), withoutQuery));
  if (files[path]) return path;
  const withExtension = `${path}.js`;
  if (!posix.extname(path) && files[withExtension]) return withExtension;
  throw new Error(`Build output "${ownerPath}" references missing file "${reference}".`);
}

function dedicatedWorkerReferences(source: string): string[] {
  return [
    ...source.matchAll(
      /new\s+Worker\s*\(\s*new\s+URL\s*\(\s*(["'`])([^"'`]+\.m?js(?:[?#][^"'`]*)?)\1\s*,\s*import\.meta\.url\s*\)/g,
    ),
  ].map((match) => match[2]);
}

function moduleReferences(source: string): string[] {
  const references = [
    ...source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'`])([^"'`]+\.m?js(?:[?#][^"'`]*)?)\1/g,
    ),
  ].map((match) => match[2]);
  return [...new Set(references)];
}

function workerFiles(
  editorFiles: Set<string>,
  manifestFiles: Set<string>,
  files: Readonly<Partial<Record<string, Uint8Array>>>,
): Set<string> {
  const workers = new Set<string>();
  const pending = [...editorFiles]
    .filter((path) => /\.m?js$/.test(path))
    .flatMap((path) =>
      dedicatedWorkerReferences(emittedSource(path, files)).map((reference) =>
        resolvedOutputReference(reference, path, files),
      ),
    );

  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || workers.has(path) || manifestFiles.has(path)) continue;
    workers.add(path);
    const source = emittedSource(path, files);
    for (const reference of [...dedicatedWorkerReferences(source), ...moduleReferences(source)]) {
      const referencedPath = resolvedOutputReference(reference, path, files);
      if (!workers.has(referencedPath) && !manifestFiles.has(referencedPath)) {
        pending.push(referencedPath);
      }
    }
  }

  return workers;
}

function serviceWorkerReferences(source: string): string[] {
  const references = new Set<string>();
  for (const match of source.matchAll(
    /\b(?:define|importScripts)\s*\(\s*\[?([^\])]+)\]?\s*[,)]/g,
  )) {
    for (const quoted of match[1].matchAll(/(["'])([^"']+)\1/g)) {
      if (!['exports', 'module', 'require'].includes(quoted[2])) references.add(quoted[2]);
    }
  }
  for (const reference of moduleReferences(source)) references.add(reference);
  return [...references];
}

function serviceWorkerFiles(
  serviceWorkerPath: string,
  files: Readonly<Partial<Record<string, Uint8Array>>>,
): Set<string> {
  const graph = new Set<string>();
  const pending = [serviceWorkerPath];
  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || graph.has(path)) continue;
    graph.add(path);
    const source = emittedSource(path, files);
    for (const reference of serviceWorkerReferences(source)) {
      const referencedPath = resolvedOutputReference(reference, path, files);
      if (!graph.has(referencedPath)) pending.push(referencedPath);
    }
  }
  return graph;
}

function precacheFiles(serviceWorker: string): Set<string> {
  return new Set(
    [...serviceWorker.matchAll(/\burl\s*:\s*(["'])([^"']+)\1/g)].map((match) =>
      match[2].replace(/^\/+/, ''),
    ),
  );
}

export function createDeliveryGraphs(options: CreateDeliveryGraphsOptions): DeliveryGraphs {
  const manifestEntries = Object.entries(options.manifest).filter(
    (entry): entry is [string, ViteManifestEntry] => entry[1]?.isEntry === true,
  );
  const entries = manifestEntries
    .map(([key, entry]) => {
      const eagerFiles = manifestEntryFiles(key, options.manifest, false);
      const completeFiles = manifestEntryFiles(key, options.manifest, true);
      const lazyFiles = new Set([...completeFiles].filter((file) => !eagerFiles.has(file)));
      const eager = graphReport(eagerFiles, options.files);
      const lazy = graphReport(lazyFiles, options.files);
      const complete = graphReport(completeFiles, options.files);
      return {
        entry: entryName(key, entry),
        rawBytes: complete.rawBytes,
        gzipBytes: complete.gzipBytes,
        brotliBytes: complete.brotliBytes,
        eager,
        lazy,
        complete,
      };
    })
    .sort((left, right) => compareText(left.entry, right.entry));

  const editorEntry = manifestEntries.find(([key, entry]) => entryName(key, entry) === 'main');
  if (!editorEntry) throw new Error('Vite manifest has no main entry.');
  const editorCompleteFiles = manifestEntryFiles(editorEntry[0], options.manifest, true);
  const allManifestFiles = new Set(
    manifestEntries.flatMap(([key]) => [...manifestEntryFiles(key, options.manifest, true)]),
  );
  const workers = workerFiles(editorCompleteFiles, allManifestFiles, options.files);
  const serviceWorkerPath = options.serviceWorkerPath ?? 'sw.js';
  const serviceWorker = serviceWorkerFiles(serviceWorkerPath, options.files);
  const precache = precacheFiles(emittedSource(serviceWorkerPath, options.files));
  const countedInstallFiles = new Set([...editorCompleteFiles, ...workers, ...serviceWorker]);
  const installAssets = new Set([...precache].filter((path) => !countedInstallFiles.has(path)));
  return {
    entries,
    workers: graphReport(workers, options.files),
    serviceWorker: graphReport(serviceWorker, options.files),
    installAssets: graphReport(installAssets, options.files),
    precache: graphReport(precache, options.files),
  };
}

function reportFiles(report: BundleReport): Map<string, BundleFileReport> {
  const files = new Map<string, BundleFileReport>();
  const graphs = [
    ...report.entries.flatMap((entry) => [entry.eager, entry.lazy, entry.complete]),
    report.workers,
    report.serviceWorker,
    report.installAssets,
    report.precache,
  ];
  for (const graph of graphs) {
    for (const file of graph.files) {
      const existing = files.get(file.path);
      if (
        existing &&
        (existing.rawBytes !== file.rawBytes ||
          existing.gzipBytes !== file.gzipBytes ||
          existing.brotliBytes !== file.brotliBytes ||
          existing.digest !== file.digest)
      ) {
        throw new Error(`Bundle report contains conflicting metadata for "${file.path}".`);
      }
      files.set(file.path, file);
    }
  }
  return files;
}

function totalFileSizes(files: Iterable<BundleFileReport>): Omit<BundleEntrySize, 'entry'> {
  let rawBytes = 0;
  let gzipBytes = 0;
  let brotliBytes = 0;
  for (const file of files) {
    rawBytes += file.rawBytes;
    gzipBytes += file.gzipBytes;
    brotliBytes += file.brotliBytes;
  }
  return { rawBytes, gzipBytes, brotliBytes };
}

export function compareBundleReports(
  before: BundleReport,
  after: BundleReport,
): BundleReportComparison {
  const beforeFiles = reportFiles(before);
  const afterFiles = reportFiles(after);
  const added = [...afterFiles.values()]
    .filter((file) => !beforeFiles.has(file.path))
    .sort((left, right) => compareText(left.path, right.path));
  const removed = [...beforeFiles.values()]
    .filter((file) => !afterFiles.has(file.path))
    .sort((left, right) => compareText(left.path, right.path));
  const changed = [...afterFiles.values()]
    .flatMap((file) => {
      const previous = beforeFiles.get(file.path);
      return previous && previous.digest !== file.digest
        ? [{ path: file.path, before: previous, after: file }]
        : [];
    })
    .sort((left, right) => compareText(left.path, right.path));
  const beforeSizes = totalFileSizes(beforeFiles.values());
  const afterSizes = totalFileSizes(afterFiles.values());
  return {
    added,
    removed,
    changed,
    rawBytes: afterSizes.rawBytes - beforeSizes.rawBytes,
    gzipBytes: afterSizes.gzipBytes - beforeSizes.gzipBytes,
    brotliBytes: afterSizes.brotliBytes - beforeSizes.brotliBytes,
  };
}
