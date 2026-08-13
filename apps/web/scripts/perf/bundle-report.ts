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

export interface ExpectedWorkerBoundary {
  identity: string;
  outputFilePrefix: string;
}

export interface WorkerBoundaryReport {
  identity: string;
  path: string;
}

export interface WorkerGraphReport extends BundleGraphReport {
  boundaries: WorkerBoundaryReport[];
}

export interface BundleEntryReport extends BundleEntrySize {
  eager: BundleGraphReport;
  lazy: BundleGraphReport;
  complete: BundleGraphReport;
}

export interface DeliveryGraphs {
  entries: BundleEntryReport[];
  workers: WorkerGraphReport;
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

export interface CreateDeliveryGraphsOptions {
  manifest: ViteManifest;
  files: Readonly<Partial<Record<string, Uint8Array>>>;
  serviceWorkerPath?: string;
  expectedWorkers?: readonly ExpectedWorkerBoundary[];
}

export const PRODUCTION_WORKER_BOUNDARIES = [
  { identity: 'gtfsWorker', outputFilePrefix: 'gtfsWorker' },
  { identity: 'gtfsReconcileWorker', outputFilePrefix: 'gtfsReconcileWorker' },
  { identity: 'osm-import-worker', outputFilePrefix: 'osm-import-worker' },
  { identity: 'previewWorkerEntry', outputFilePrefix: 'previewWorkerEntry' },
  { identity: 'svgWorkerEntry', outputFilePrefix: 'svgWorkerEntry' },
  { identity: 'storageSerializerWorker', outputFilePrefix: 'storageSerializerWorker' },
  {
    identity: 'storage-deserializer-worker',
    outputFilePrefix: 'storage-deserializer-worker',
  },
] as const satisfies readonly ExpectedWorkerBoundary[];

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

interface WorkerOutput {
  files: Set<string>;
  entries: Set<string>;
}

function workerOutput(
  editorFiles: Set<string>,
  manifestFiles: Set<string>,
  files: Readonly<Partial<Record<string, Uint8Array>>>,
): WorkerOutput {
  const workers = new Set<string>();
  const entries = new Set(
    [...editorFiles]
      .filter((path) => /\.m?js$/.test(path))
      .flatMap((path) =>
        dedicatedWorkerReferences(emittedSource(path, files)).map((reference) =>
          resolvedOutputReference(reference, path, files),
        ),
      ),
  );
  const pending = [...entries];

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

  return { files: workers, entries };
}

function outputMatchesBoundary(path: string, boundary: ExpectedWorkerBoundary): boolean {
  const name = basename(path);
  return (
    name === `${boundary.outputFilePrefix}.js` ||
    (name.startsWith(`${boundary.outputFilePrefix}-`) && name.endsWith('.js'))
  );
}

function assertUniqueExpectedWorkers(expected: readonly ExpectedWorkerBoundary[]): void {
  if (expected.length === 0) throw new Error('Expected Worker roster must not be empty.');
  const identities = new Set<string>();
  const prefixes = new Set<string>();
  for (const boundary of expected) {
    if (identities.has(boundary.identity) || prefixes.has(boundary.outputFilePrefix)) {
      throw new Error(`Expected Worker roster repeats ${boundary.identity}.`);
    }
    identities.add(boundary.identity);
    prefixes.add(boundary.outputFilePrefix);
  }
}

interface WorkerClassifications {
  classified: Map<string, string[]>;
  extras: string[];
}

function classifyWorkerBoundaries(
  paths: Set<string>,
  expected: readonly ExpectedWorkerBoundary[],
): WorkerClassifications {
  const classified = new Map<string, string[]>();
  const extras: string[] = [];
  for (const path of paths) {
    const matches = expected.filter((boundary) => outputMatchesBoundary(path, boundary));
    if (matches.length !== 1) {
      extras.push(path);
      continue;
    }
    const boundary = matches[0];
    const claimed = classified.get(boundary.identity) ?? [];
    claimed.push(path);
    classified.set(boundary.identity, claimed);
  }
  return { classified, extras };
}

function validateWorkerBoundaries(
  paths: Set<string>,
  expected: readonly ExpectedWorkerBoundary[],
): WorkerBoundaryReport[] {
  assertUniqueExpectedWorkers(expected);
  const { classified, extras } = classifyWorkerBoundaries(paths, expected);
  const missing = expected
    .filter((boundary) => !classified.has(boundary.identity))
    .map((boundary) => boundary.identity);
  const duplicates = [...classified]
    .filter(([, claimed]) => claimed.length > 1)
    .map(([identity, claimed]) => `${identity} (${claimed.sort(compareText).join(', ')})`)
    .sort(compareText);
  const failures = [
    ...(missing.length > 0 ? [`missing ${missing.join(', ')}`] : []),
    ...(extras.length > 0 ? [`extra ${extras.sort(compareText).join(', ')}`] : []),
    ...(duplicates.length > 0 ? [`duplicate ${duplicates.join('; ')}`] : []),
  ];
  if (failures.length > 0) {
    throw new Error(`Dedicated Worker roster mismatch: ${failures.join('; ')}.`);
  }
  const boundaries: WorkerBoundaryReport[] = [];
  for (const boundary of expected) {
    const claimed = classified.get(boundary.identity);
    const path = claimed?.[0];
    if (path) boundaries.push({ identity: boundary.identity, path });
  }
  return boundaries.sort((left, right) => compareText(left.identity, right.identity));
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
  const worker = workerOutput(editorCompleteFiles, allManifestFiles, options.files);
  const workerBoundaries = validateWorkerBoundaries(
    worker.entries,
    options.expectedWorkers ?? PRODUCTION_WORKER_BOUNDARIES,
  );
  const serviceWorkerPath = options.serviceWorkerPath ?? 'sw.js';
  const serviceWorker = serviceWorkerFiles(serviceWorkerPath, options.files);
  const precache = precacheFiles(emittedSource(serviceWorkerPath, options.files));
  const countedInstallFiles = new Set([...editorCompleteFiles, ...worker.files, ...serviceWorker]);
  const installAssets = new Set([...precache].filter((path) => !countedInstallFiles.has(path)));
  return {
    entries,
    workers: { ...graphReport(worker.files, options.files), boundaries: workerBoundaries },
    serviceWorker: graphReport(serviceWorker, options.files),
    installAssets: graphReport(installAssets, options.files),
    precache: graphReport(precache, options.files),
  };
}

export { compareBundleReports } from './bundle-report-comparison';
export type {
  BundleFileChange,
  BundleGraphComparison,
  BundleMembershipTransition,
  BundleReportComparison,
} from './bundle-report-comparison';
