import { describe, expect, it } from 'vitest';
import {
  compareBundleReports,
  createDeliveryGraphs,
  type BundleGraphReport,
  type BundleReport,
  type DeliveryGraphs,
  type ViteManifest,
} from '../../scripts/perf/report-bundle';

const manifest: ViteManifest = {
  'index.html': {
    file: 'assets/main.js',
    name: 'main',
    isEntry: true,
    imports: ['_shared.js'],
    dynamicImports: ['src/Dialog.tsx'],
    css: ['assets/main.css'],
  },
  'embed.html': {
    file: 'assets/embed.js',
    name: 'embed',
    isEntry: true,
    imports: ['_shared.js'],
  },
  '_shared.js': {
    file: 'assets/shared.js',
    css: ['assets/shared.css'],
    assets: ['assets/font.woff2'],
  },
  'src/Dialog.tsx': {
    file: 'assets/dialog.js',
    imports: ['_shared.js', 'index.html'],
  },
};

function encodedFiles(contents: Record<string, string>): Record<string, Uint8Array> {
  return Object.fromEntries(
    Object.entries(contents).map(([path, source]) => [path, new TextEncoder().encode(source)]),
  );
}

function fixtureFiles(options: { changedMain?: boolean; extraIcon?: boolean } = {}) {
  const precache = [
    'index.html',
    'manifest.json',
    'icons/app-icon.svg',
    ...(options.extraIcon ? ['icons/app-icon-192.png'] : []),
    'assets/main.js',
    'assets/main.css',
    'assets/shared.js',
    'assets/shared.css',
    'assets/font.woff2',
    'assets/dialog.js',
    'assets/storage-worker.js',
    'assets/dialog-worker.js',
  ];
  const precacheSource = precache.map((url) => `{url:"${url}",revision:null}`).join(',');

  return encodedFiles({
    'index.html': '<main></main>',
    'embed.html': '<figure></figure>',
    'manifest.json': '{"name":"TransitMapper"}',
    'icons/app-icon.svg': '<svg></svg>',
    ...(options.extraIcon ? { 'icons/app-icon-192.png': 'new icon' } : {}),
    'assets/main.js':
      (options.changedMain ? 'const release=2;' : 'const release=1;') +
      'new Worker(new URL("/assets/storage-worker.js",import.meta.url),{type:"module"});',
    'assets/main.css': '.app{display:grid}',
    'assets/embed.js': 'const embed=true;',
    'assets/shared.js': 'export const shared=true;',
    'assets/shared.css': '.map{contain:strict}',
    'assets/font.woff2': 'font bytes',
    'assets/dialog.js':
      'new Worker(new URL("/assets/dialog-worker.js",import.meta.url),{type:"module"});',
    'assets/storage-worker.js': 'self.onmessage=()=>{};',
    'assets/dialog-worker.js': 'self.onmessage=()=>{};',
    'sw.js': `define(["./workbox-runtime"],function(w){w.precacheAndRoute([${precacheSource}])});`,
    'workbox-runtime.js': 'define([],function(){return{}});',
  });
}

function deliveryGraphs(files = fixtureFiles()): DeliveryGraphs {
  return createDeliveryGraphs({ manifest, files });
}

function paths(graph: BundleGraphReport): string[] {
  return graph.files.map((file) => file.path);
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Fixture has no ${label}.`);
  return value;
}

function report(files: Record<string, Uint8Array>, generatedAt: string): BundleReport {
  return {
    schemaVersion: 3,
    generatedAt,
    ...deliveryGraphs(files),
    chunks: [],
    violations: [],
    chunkViolations: [],
  };
}

describe('bundle report delivery graphs', () => {
  it('separates each entry static closure from files reached only through dynamic imports', () => {
    const graphs = deliveryGraphs();
    const main = required(
      graphs.entries.find((entry) => entry.entry === 'main'),
      'main entry',
    );
    const embed = required(
      graphs.entries.find((entry) => entry.entry === 'embed'),
      'embed entry',
    );

    expect(paths(main.eager)).toEqual([
      'assets/font.woff2',
      'assets/main.css',
      'assets/main.js',
      'assets/shared.css',
      'assets/shared.js',
      'index.html',
    ]);
    expect(paths(main.lazy)).toEqual(['assets/dialog.js']);
    expect(paths(main.complete)).toEqual([...paths(main.eager), ...paths(main.lazy)].sort());
    expect(paths(embed.eager)).toEqual([
      'assets/embed.js',
      'assets/font.woff2',
      'assets/shared.css',
      'assets/shared.js',
      'embed.html',
    ]);
    expect(paths(embed.lazy)).toEqual([]);
  });

  it('reports Workers, service-worker runtime, install assets, and precache as distinct graphs', () => {
    const graphs = deliveryGraphs();
    const mainComplete = new Set(
      paths(
        required(
          graphs.entries.find((entry) => entry.entry === 'main'),
          'main entry',
        ).complete,
      ),
    );

    expect(paths(graphs.workers)).toEqual(['assets/dialog-worker.js', 'assets/storage-worker.js']);
    expect(paths(graphs.serviceWorker)).toEqual(['sw.js', 'workbox-runtime.js']);
    expect(paths(graphs.installAssets)).toEqual(['icons/app-icon.svg', 'manifest.json']);
    expect(paths(graphs.precache)).toEqual([
      'assets/dialog-worker.js',
      'assets/dialog.js',
      'assets/font.woff2',
      'assets/main.css',
      'assets/main.js',
      'assets/shared.css',
      'assets/shared.js',
      'assets/storage-worker.js',
      'icons/app-icon.svg',
      'index.html',
      'manifest.json',
    ]);
    expect(paths(graphs.workers).filter((path) => mainComplete.has(path))).toEqual([]);
    expect(
      paths(graphs.serviceWorker).filter(
        (path) => mainComplete.has(path) || paths(graphs.workers).includes(path),
      ),
    ).toEqual([]);
    expect(paths(graphs.installAssets).some((path) => mainComplete.has(path))).toBe(false);
    expect(paths(graphs.installAssets).some((path) => paths(graphs.workers).includes(path))).toBe(
      false,
    );
    expect(
      paths(graphs.installAssets).some((path) => paths(graphs.serviceWorker).includes(path)),
    ).toBe(false);
  });

  it('adds deterministic sizes and a content digest to every sorted file', () => {
    const graphs = deliveryGraphs();
    const firstEntry = required(graphs.entries.at(0), 'first entry');
    const file = required(firstEntry.complete.files.at(0), 'first complete file');

    expect(graphs.entries.map((entry) => entry.entry)).toEqual(['embed', 'main']);
    expect(typeof file.rawBytes).toBe('number');
    expect(typeof file.gzipBytes).toBe('number');
    expect(typeof file.brotliBytes).toBe('number');
    expect(file.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(graphs.precache.rawBytes).toBe(
      graphs.precache.files.reduce((total, candidate) => total + candidate.rawBytes, 0),
    );
    expect(paths(graphs.precache)).toEqual([...paths(graphs.precache)].sort());
    expect(deliveryGraphs()).toEqual(graphs);
  });
});

describe('bundle report comparisons', () => {
  it('reports unique added, removed, and changed files with encoded-size deltas', () => {
    const before = report(fixtureFiles(), '2026-08-12T00:00:00.000Z');
    const after = report(
      fixtureFiles({ changedMain: true, extraIcon: true }),
      '2026-08-13T00:00:00.000Z',
    );
    const generatedAtOnly = report(fixtureFiles(), '2026-08-14T00:00:00.000Z');
    const comparison = compareBundleReports(before, after);
    const reverseComparison = compareBundleReports(after, before);

    expect(compareBundleReports(before, generatedAtOnly)).toEqual({
      added: [],
      removed: [],
      changed: [],
      rawBytes: 0,
      gzipBytes: 0,
      brotliBytes: 0,
    });
    expect(comparison.added.map((file) => file.path)).toEqual(['icons/app-icon-192.png']);
    expect(comparison.removed).toEqual([]);
    expect(comparison.changed.map((file) => file.path)).toEqual(['assets/main.js', 'sw.js']);
    expect(reverseComparison.added).toEqual([]);
    expect(reverseComparison.removed.map((file) => file.path)).toEqual(['icons/app-icon-192.png']);
    expect(comparison.rawBytes).toBe(
      comparison.added[0].rawBytes +
        comparison.changed.reduce(
          (total, file) => total + file.after.rawBytes - file.before.rawBytes,
          0,
        ),
    );
    expect(comparison.gzipBytes).toBe(
      comparison.added[0].gzipBytes +
        comparison.changed.reduce(
          (total, file) => total + file.after.gzipBytes - file.before.gzipBytes,
          0,
        ),
    );
    expect(comparison.brotliBytes).toBe(
      comparison.added[0].brotliBytes +
        comparison.changed.reduce(
          (total, file) => total + file.after.brotliBytes - file.before.brotliBytes,
          0,
        ),
    );
  });
});
