import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import type { BundleBudgetViolation, BundleEntrySize } from '../../src/perf/bundleBudget';
import type { PerformanceChunkSize, PerformanceChunkViolation } from '../../src/perf/chunkPolicy';
import { emittedSource, moduleReferences, resolvedOutputReference } from './bundle-output';
import { workerOutput } from './worker-output';

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
  {
    identity: 'diagram-layout-worker-entry',
    outputFilePrefix: 'diagram-layout-worker-entry',
  },
  {
    identity: 'feature-projection-worker-entry',
    outputFilePrefix: 'feature-projection-worker-entry',
  },
  { identity: 'gtfsWorker', outputFilePrefix: 'gtfsWorker' },
  { identity: 'gtfsReconcileWorker', outputFilePrefix: 'gtfsReconcileWorker' },
  { identity: 'osm-import-worker', outputFilePrefix: 'osm-import-worker' },
  { identity: 'previewWorkerEntry', outputFilePrefix: 'previewWorkerEntry' },
  { identity: 'svgWorkerEntry', outputFilePrefix: 'svgWorkerEntry' },
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

function deliveryEntryName(key: string, entry: ViteManifestEntry): string {
  const name = entryName(key, entry);
  return name === 'viewer-application' ? 'viewer' : name;
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

function manifestDependencyNames(key: string, manifest: ViteManifest): Set<string> {
  const names = new Set<string>();
  const pending = [key];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!candidate || visited.has(candidate)) continue;
    visited.add(candidate);
    const entry = manifest[candidate];
    if (!entry) throw new Error(`Vite manifest import "${candidate}" does not exist.`);
    if (candidate !== key && entry.name) names.add(entry.name);
    pending.push(...(entry.imports ?? []), ...(entry.dynamicImports ?? []));
  }
  return names;
}

function validateEmbedBoundary(
  manifestEntries: readonly [string, ViteManifestEntry][],
  manifest: ViteManifest,
): void {
  const embedEntry = manifestEntries.find(([key, entry]) => entryName(key, entry) === 'embed');
  if (!embedEntry) return;
  const forbidden = [...manifestDependencyNames(embedEntry[0], manifest)]
    .filter((name) => name === 'react-runtime' || name === 'renderer' || name === 'workspace')
    .sort(compareText);
  if (forbidden.length > 0) {
    throw new Error(`Embed entry imports forbidden chunks: ${forbidden.join(', ')}.`);
  }
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

function linkedInstallAssetFiles(
  source: string,
  files: Readonly<Partial<Record<string, Uint8Array>>>,
): Set<string> {
  const installAssets = new Set<string>();
  for (const match of source.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = /\brel\s*=\s*(["'])([^"']+)\1/i.exec(tag)?.[2] ?? '';
    if (
      !rel.split(/\s+/).some((value) => ['icon', 'apple-touch-icon', 'manifest'].includes(value))
    ) {
      continue;
    }
    const href = /\bhref\s*=\s*(["'])([^"']+)\1/i.exec(tag)?.[2];
    if (href) installAssets.add(resolvedOutputReference(href, 'index.html', files));
  }
  return installAssets;
}

function manifestIconFiles(
  manifestPath: string,
  files: Readonly<Partial<Record<string, Uint8Array>>>,
): string[] {
  const value = JSON.parse(emittedSource(manifestPath, files)) as { icons?: unknown };
  if (!Array.isArray(value.icons)) return [];
  const icons: unknown[] = value.icons;
  return icons.map((icon) => {
    if (!icon || typeof icon !== 'object') {
      throw new Error(`Build output "${manifestPath}" has an invalid install icon.`);
    }
    const { src } = icon as Record<string, unknown>;
    if (typeof src !== 'string') {
      throw new Error(`Build output "${manifestPath}" has an invalid install icon.`);
    }
    return resolvedOutputReference(src, manifestPath, files);
  });
}

function installAssetFiles(files: Readonly<Partial<Record<string, Uint8Array>>>): Set<string> {
  const assets = linkedInstallAssetFiles(emittedSource('index.html', files), files);
  for (const path of [...assets]) {
    if (basename(path) !== 'manifest.json') continue;
    for (const icon of manifestIconFiles(path, files)) assets.add(icon);
  }
  return assets;
}

export function createDeliveryGraphs(options: CreateDeliveryGraphsOptions): DeliveryGraphs {
  const allEntries = Object.entries(options.manifest).filter(
    (entry): entry is [string, ViteManifestEntry] => entry[1] !== undefined,
  );
  const manifestEntries = allEntries.filter(
    (entry): entry is [string, ViteManifestEntry] => entry[1].isEntry === true,
  );
  validateEmbedBoundary(manifestEntries, options.manifest);
  const routeHostEntries = allEntries.filter(
    ([key, entry]) => entry.isEntry !== true && deliveryEntryName(key, entry) === 'viewer',
  );
  const entries = [...manifestEntries, ...routeHostEntries]
    .map(([key, entry]) => {
      const eagerFiles = manifestEntryFiles(key, options.manifest, false);
      const completeFiles = manifestEntryFiles(key, options.manifest, true);
      const lazyFiles = new Set([...completeFiles].filter((file) => !eagerFiles.has(file)));
      const eager = graphReport(eagerFiles, options.files);
      const lazy = graphReport(lazyFiles, options.files);
      const complete = graphReport(completeFiles, options.files);
      return {
        entry: deliveryEntryName(key, entry),
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
  const installAssets = installAssetFiles(options.files);
  return {
    entries,
    workers: { ...graphReport(worker.files, options.files), boundaries: workerBoundaries },
    serviceWorker: graphReport(serviceWorker, options.files),
    installAssets: graphReport(installAssets, options.files),
    precache: graphReport(precache, options.files),
  };
}
