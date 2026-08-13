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

const fixtureWorkers = [
  { identity: 'dialog-worker', outputFilePrefix: 'dialog-worker' },
  { identity: 'storage-worker', outputFilePrefix: 'storage-worker' },
] as const;

const productionWorkerIdentities = [
  'gtfsWorker',
  'gtfsReconcileWorker',
  'osm-import-worker',
  'previewWorkerEntry',
  'svgWorkerEntry',
  'storageSerializerWorker',
  'storage-deserializer-worker',
] as const;

function encodedFiles(contents: Record<string, string>): Record<string, Uint8Array> {
  return Object.fromEntries(
    Object.entries(contents).map(([path, source]) => [path, new TextEncoder().encode(source)]),
  );
}

function encoded(source: string): Uint8Array {
  return new TextEncoder().encode(source);
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

function deliveryGraphs(
  files = fixtureFiles(),
  buildManifest: ViteManifest = manifest,
): DeliveryGraphs {
  return createDeliveryGraphs({
    manifest: buildManifest,
    files,
    expectedWorkers: fixtureWorkers,
  });
}

function paths(graph: BundleGraphReport): string[] {
  return graph.files.map((file) => file.path);
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Fixture has no ${label}.`);
  return value;
}

function report(
  files: Record<string, Uint8Array>,
  generatedAt: string,
  buildManifest: ViteManifest = manifest,
): BundleReport {
  return {
    schemaVersion: 3,
    generatedAt,
    ...deliveryGraphs(files, buildManifest),
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

  it('requires the complete production Worker roster unless a fixture roster is explicit', () => {
    expect(() => createDeliveryGraphs({ manifest, files: fixtureFiles() })).toThrow(
      'missing gtfsWorker',
    );
  });

  it('reports the seven production Worker boundaries by source-output identity', () => {
    const workerReferences = productionWorkerIdentities.map(
      (identity) =>
        `new Worker(new URL("/assets/${identity}-abcdefgh.js",import.meta.url),` +
        `{type:"module",name:"${identity}"});`,
    );
    const files = encodedFiles({
      'index.html': '<main></main>',
      'assets/main.js': workerReferences.join(''),
      ...Object.fromEntries(
        productionWorkerIdentities.map((identity) => [
          `assets/${identity}-abcdefgh.js`,
          'self.onmessage=()=>{};',
        ]),
      ),
      'sw.js':
        'define(["./workbox-runtime"],function(w){w.precacheAndRoute(' +
        '[{url:"index.html",revision:null},{url:"assets/main.js",revision:null}])});',
      'workbox-runtime.js': 'define([],function(){return{}});',
    });
    const graphs = createDeliveryGraphs({
      manifest: {
        'index.html': { file: 'assets/main.js', name: 'main', isEntry: true },
      },
      files,
    });
    const workers = graphs.workers as typeof graphs.workers & {
      boundaries: { identity: string; path: string }[];
    };

    expect(graphs.workers).toHaveProperty('boundaries');
    expect(workers.boundaries.map((boundary) => boundary.identity).sort()).toEqual(
      [...productionWorkerIdentities].sort(),
    );
    expect(workers.boundaries).toHaveLength(7);
  });

  it('fails when equivalent Worker syntax escapes classification', () => {
    const workerReferences = productionWorkerIdentities.map((identity) =>
      identity === 'gtfsWorker'
        ? 'const gtfsUrl=new URL("/assets/gtfsWorker-abcdefgh.js",import.meta.url);' +
          'new Worker(gtfsUrl,{type:"module",name:"gtfsWorker"});'
        : `new Worker(new URL("/assets/${identity}-abcdefgh.js",import.meta.url),` +
          `{type:"module",name:"${identity}"});`,
    );
    const files = encodedFiles({
      'index.html': '<main></main>',
      'assets/main.js': workerReferences.join(''),
      ...Object.fromEntries(
        productionWorkerIdentities.map((identity) => [
          `assets/${identity}-abcdefgh.js`,
          'self.onmessage=()=>{};',
        ]),
      ),
      'sw.js': 'define(["./workbox-runtime"],function(w){w.precacheAndRoute([])});',
      'workbox-runtime.js': 'define([],function(){return{}});',
    });

    expect(() =>
      createDeliveryGraphs({
        manifest: {
          'index.html': { file: 'assets/main.js', name: 'main', isEntry: true },
        },
        files,
      }),
    ).toThrow('missing gtfsWorker');
  });

  it('fails when a supported Worker reference is outside the expected roster', () => {
    const files = fixtureFiles();
    files['assets/main.js'] = encoded(
      Buffer.from(files['assets/main.js']).toString('utf8') +
        'new Worker(new URL("/assets/unexpected-worker.js",import.meta.url));',
    );
    files['assets/unexpected-worker.js'] = encoded('self.onmessage=()=>{};');

    expect(() => deliveryGraphs(files)).toThrow('extra assets/unexpected-worker.js');
  });

  it('fails when two Worker outputs claim one expected boundary', () => {
    const files = fixtureFiles();
    files['assets/main.js'] = encoded(
      'new Worker(new URL("/assets/storage-worker-aaaaaaaa.js",import.meta.url));' +
        'new Worker(new URL("/assets/storage-worker-bbbbbbbb.js",import.meta.url));',
    );
    files['assets/storage-worker-aaaaaaaa.js'] = encoded('self.onmessage=()=>{};');
    files['assets/storage-worker-bbbbbbbb.js'] = encoded('self.onmessage=()=>{};');

    expect(() => deliveryGraphs(files)).toThrow('duplicate storage-worker');
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

    const generatedAtComparison = compareBundleReports(before, generatedAtOnly);
    expect(generatedAtComparison).toMatchObject({
      added: [],
      removed: [],
      changed: [],
      rawBytes: 0,
      gzipBytes: 0,
      brotliBytes: 0,
    });
    expect(generatedAtComparison.graphs.every((graph) => graph.rawBytes === 0)).toBe(true);
    expect(generatedAtComparison.membershipTransitions).toEqual([]);
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

  it('reports unchanged files moving between eager and lazy entry graphs', () => {
    const files = fixtureFiles();
    const eagerDialogManifest: ViteManifest = {
      ...manifest,
      'index.html': {
        ...required(manifest['index.html'], 'main manifest entry'),
        imports: ['_shared.js', 'src/Dialog.tsx'],
        dynamicImports: [],
      },
    };
    const before = report(files, '2026-08-12T00:00:00.000Z');
    const after = report(files, '2026-08-13T00:00:00.000Z', eagerDialogManifest);
    const comparison = compareBundleReports(before, after);

    expect(comparison).toHaveProperty('graphs');
    expect(comparison.added).toEqual([]);
    expect(comparison.removed).toEqual([]);
    expect(comparison.changed).toEqual([]);
    expect(comparison.rawBytes).toBe(0);
    const dialog = required(
      before.entries.find((entry) => entry.entry === 'main')?.lazy.files.at(0),
      'lazy dialog file',
    );
    const eager = required(
      comparison.graphs.find((graph) => graph.graph === 'entries.main.eager'),
      'main eager comparison',
    );
    const lazy = required(
      comparison.graphs.find((graph) => graph.graph === 'entries.main.lazy'),
      'main lazy comparison',
    );
    const complete = required(
      comparison.graphs.find((graph) => graph.graph === 'entries.main.complete'),
      'main complete comparison',
    );
    expect(eager.added.map((file) => file.path)).toEqual(['assets/dialog.js']);
    expect(eager.rawBytes).toBe(dialog.rawBytes);
    expect(lazy.removed.map((file) => file.path)).toEqual(['assets/dialog.js']);
    expect(lazy.rawBytes).toBe(-dialog.rawBytes);
    expect(complete.rawBytes).toBe(0);
    expect(comparison.membershipTransitions).toContainEqual({
      path: 'assets/dialog.js',
      addedTo: ['entries.main.eager'],
      removedFrom: ['entries.main.lazy'],
    });
  });
});
