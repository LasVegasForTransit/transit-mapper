/* eslint-disable max-lines -- One shared build fixture keeps graph and comparison evidence consistent. */
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareBundleReports,
  createDeliveryGraphs,
  initialDeliverySizes,
  parseBundleReportArguments,
  writeBundleReportArtifacts,
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
    dynamicImports: ['src/Dialog.tsx', 'src/viewer/viewer-application.tsx'],
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
  'src/viewer/viewer-application.tsx': {
    file: 'assets/viewer.js',
    name: 'viewer-application',
    imports: ['_shared.js'],
  },
};

const fixtureWorkers = [
  { identity: 'dialog-worker', outputFilePrefix: 'dialog-worker' },
  { identity: 'storage-worker', outputFilePrefix: 'storage-worker' },
] as const;

const productionWorkerIdentities = [
  'diagram-layout-worker-entry',
  'feature-projection-worker-entry',
  'gtfsWorker',
  'gtfsReconcileWorker',
  'osm-import-worker',
  'previewWorkerEntry',
  'svgWorkerEntry',
  'storage-deserializer-worker',
] as const;

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'transitmapper-bundle-report-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true });
  }
}

function encodedFiles(contents: Record<string, string>): Record<string, Uint8Array> {
  return Object.fromEntries(
    Object.entries(contents).map(([path, source]) => [path, new TextEncoder().encode(source)]),
  );
}

function encoded(source: string): Uint8Array {
  return new TextEncoder().encode(source);
}

function productionFiles(workerReferences: readonly string[]): Record<string, Uint8Array> {
  return encodedFiles({
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
    'index.html':
      '<link rel="icon" href="/icons/app-icon.svg">' +
      '<link rel="manifest" href="/manifest.json"><main></main>',
    'embed.html': '<figure></figure>',
    'manifest.json': JSON.stringify({
      name: 'TransitMapper',
      icons: [
        { src: '/icons/app-icon.svg' },
        ...(options.extraIcon ? [{ src: '/icons/app-icon-192.png' }] : []),
      ],
    }),
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
    'assets/viewer.js': 'const viewer=true;',
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
  it('budgets only the eager editor graph that a first load transfers', () => {
    const graphs = deliveryGraphs();
    const main = required(
      graphs.entries.find((entry) => entry.entry === 'main'),
      'main entry',
    );

    expect(initialDeliverySizes(graphs.entries)).toContainEqual({
      entry: 'main',
      rawBytes: main.eager.rawBytes,
      gzipBytes: main.eager.gzipBytes,
      brotliBytes: main.eager.brotliBytes,
    });
    expect(main.complete.gzipBytes).toBeGreaterThan(main.eager.gzipBytes);
  });

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
    expect(paths(main.lazy)).toEqual(['assets/dialog.js', 'assets/viewer.js']);
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

  it('reports the viewer route host as its own static delivery graph', () => {
    const viewer = required(
      deliveryGraphs().entries.find((entry) => entry.entry === 'viewer'),
      'viewer entry',
    );

    expect(paths(viewer.eager)).toEqual([
      'assets/font.woff2',
      'assets/shared.css',
      'assets/shared.js',
      'assets/viewer.js',
    ]);
    expect(paths(viewer.lazy)).toEqual([]);
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

  it('reports install artwork even when adaptive policy excludes it from precache', () => {
    const files = fixtureFiles();
    files['index.html'] = encoded(
      '<link rel="icon" href="/favicon.svg"><link rel="manifest" href="/manifest.json">',
    );
    files['favicon.svg'] = encoded('<svg></svg>');
    files['manifest.json'] = encoded(JSON.stringify({ icons: [{ src: '/icons/app-icon.svg' }] }));
    files['sw.js'] = encoded(
      'define(["./workbox-runtime"],function(w){w.precacheAndRoute(' +
        '[{url:"index.html",revision:null},{url:"assets/main.js",revision:null}])});',
    );

    const graphs = deliveryGraphs(files);

    expect(paths(graphs.installAssets)).toEqual([
      'favicon.svg',
      'icons/app-icon.svg',
      'manifest.json',
    ]);
    expect(paths(graphs.precache)).not.toContain('icons/app-icon.svg');
  });

  it('validates supported Worker boundaries created inside a Worker source graph', () => {
    const files = fixtureFiles();
    files['assets/main.js'] = encoded(
      'new Worker(new URL("/assets/storage-worker.js",import.meta.url));',
    );
    files['assets/storage-worker.js'] = encoded(
      'new Worker(new URL("./dialog-worker.js",import.meta.url));',
    );
    files['assets/dialog.js'] = encoded('export const dialog=true;');

    const graphs = deliveryGraphs(files);

    expect(graphs.workers.boundaries).toEqual([
      { identity: 'dialog-worker', path: 'assets/dialog-worker.js' },
      { identity: 'storage-worker', path: 'assets/storage-worker.js' },
    ]);
    expect(paths(graphs.workers)).toEqual(['assets/dialog-worker.js', 'assets/storage-worker.js']);
  });

  it('adds deterministic sizes and a content digest to every sorted file', () => {
    const graphs = deliveryGraphs();
    const firstEntry = required(graphs.entries.at(0), 'first entry');
    const file = required(firstEntry.complete.files.at(0), 'first complete file');

    expect(graphs.entries.map((entry) => entry.entry)).toEqual(['embed', 'main', 'viewer']);
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
      'missing diagram-layout-worker-entry',
    );
  });

  it('reports every declared production Worker boundary by source-output identity', () => {
    const workerReferences = productionWorkerIdentities.map(
      (identity) =>
        `new Worker(new URL("/assets/${identity}-abcdefgh.js",import.meta.url),` +
        `{type:"module",name:"${identity}"});`,
    );
    const files = productionFiles(workerReferences);
    const graphs = createDeliveryGraphs({
      manifest: {
        'index.html': { file: 'assets/main.js', name: 'main', isEntry: true },
      },
      files,
    });

    expect(graphs.workers).toHaveProperty('boundaries');
    expect(graphs.workers.boundaries.map((boundary) => boundary.identity).sort()).toEqual(
      [...productionWorkerIdentities].sort(),
    );
    expect(graphs.workers.boundaries).toHaveLength(productionWorkerIdentities.length);
  });

  it('fails explicitly when a production Worker uses unsupported equivalent syntax', () => {
    const workerReferences = productionWorkerIdentities.map((identity) =>
      identity === 'gtfsWorker'
        ? 'const gtfsUrl=new URL("/assets/gtfsWorker-abcdefgh.js",import.meta.url);' +
          'new Worker(gtfsUrl,{type:"module",name:"gtfsWorker"});'
        : `new Worker(new URL("/assets/${identity}-abcdefgh.js",import.meta.url),` +
          `{type:"module",name:"${identity}"});`,
    );
    const files = productionFiles(workerReferences);

    expect(() =>
      createDeliveryGraphs({
        manifest: {
          'index.html': { file: 'assets/main.js', name: 'main', isEntry: true },
        },
        files,
      }),
    ).toThrow('Unsupported dedicated Worker constructor for "/assets/gtfsWorker-abcdefgh.js"');
  });

  it('fails when unsupported equivalent syntax hides a Worker outside the roster', () => {
    const equivalents = [
      'const unexpectedUrl=new URL("/assets/unexpected-worker.js",import.meta.url);' +
        'new Worker(unexpectedUrl,{type:"module"});',
      'let unexpectedUrl;unexpectedUrl=' +
        'new URL("/assets/unexpected-worker.js",import.meta.url);' +
        'new Worker(unexpectedUrl,{type:"module"});',
      'const unexpectedUrl=new URL("/assets/unexpected-worker.js",import.meta.url);' +
        'new globalThis.Worker(unexpectedUrl,{type:"module"});',
    ];
    for (const equivalent of equivalents) {
      const files = fixtureFiles();
      files['assets/main.js'] = encoded(
        Buffer.from(files['assets/main.js']).toString('utf8') + equivalent,
      );
      files['assets/unexpected-worker.js'] = encoded('self.onmessage=()=>{};');

      expect(() => deliveryGraphs(files)).toThrow(
        'Unsupported dedicated Worker constructor for "/assets/unexpected-worker.js"',
      );
    }
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
  it('accepts comparison input only through an explicit frozen report path', () => {
    expect(parseBundleReportArguments([])).toEqual({});
    expect(parseBundleReportArguments(['--compare-to', '/tmp/frozen-bundle-report.json'])).toEqual({
      frozenReportPath: '/tmp/frozen-bundle-report.json',
    });
    expect(() => parseBundleReportArguments(['--compare-to'])).toThrow(
      'The --compare-to option requires a frozen BundleReport path.',
    );
    expect(() => parseBundleReportArguments(['/tmp/implicit-bundle-report.json'])).toThrow(
      'Unknown bundle report option',
    );
  });

  it('writes deterministic comparison evidence without modifying the frozen report', async () => {
    await withTemporaryDirectory(async (directory) => {
      const frozenReportPath = join(directory, 'frozen-bundle-report.json');
      const firstReportPath = join(directory, 'first', 'bundle-report.json');
      const firstComparisonPath = join(directory, 'first', 'bundle-report-comparison.json');
      const secondReportPath = join(directory, 'second', 'bundle-report.json');
      const secondComparisonPath = join(directory, 'second', 'bundle-report-comparison.json');
      const frozen = report(fixtureFiles(), '2026-08-12T00:00:00.000Z');
      const candidate = report(
        fixtureFiles({ changedMain: true, extraIcon: true }),
        '2026-08-13T00:00:00.000Z',
      );
      const frozenContents = `${JSON.stringify(frozen, null, 2)}\n`;
      await writeFile(frozenReportPath, frozenContents, 'utf8');

      await writeBundleReportArtifacts(candidate, {
        reportPath: firstReportPath,
        comparisonPath: firstComparisonPath,
        frozenReportPath,
      });
      await writeBundleReportArtifacts(candidate, {
        reportPath: secondReportPath,
        comparisonPath: secondComparisonPath,
        frozenReportPath,
      });

      const firstComparison = await readFile(firstComparisonPath, 'utf8');
      expect(firstComparison).toBe(await readFile(secondComparisonPath, 'utf8'));
      expect(JSON.parse(firstComparison)).toEqual(compareBundleReports(frozen, candidate));
      expect(JSON.parse(await readFile(firstReportPath, 'utf8'))).toEqual(candidate);
      expect(await readFile(frozenReportPath, 'utf8')).toBe(frozenContents);
    });
  });

  it('rejects artifact path collisions that could overwrite either report', async () => {
    await withTemporaryDirectory(async (directory) => {
      const frozenReportPath = join(directory, 'frozen-bundle-report.json');
      const frozen = report(fixtureFiles(), '2026-08-12T00:00:00.000Z');
      const frozenContents = `${JSON.stringify(frozen, null, 2)}\n`;
      await writeFile(frozenReportPath, frozenContents, 'utf8');

      await expect(
        writeBundleReportArtifacts(frozen, {
          reportPath: frozenReportPath,
          comparisonPath: join(directory, 'bundle-report-comparison.json'),
          frozenReportPath,
        }),
      ).rejects.toThrow('Bundle report outputs must not overwrite the frozen report.');
      expect(await readFile(frozenReportPath, 'utf8')).toBe(frozenContents);
      const aliasedReportPath = join(directory, 'aliased-bundle-report.json');
      await link(frozenReportPath, aliasedReportPath);
      await expect(
        writeBundleReportArtifacts(frozen, {
          reportPath: aliasedReportPath,
          comparisonPath: join(directory, 'aliased-comparison.json'),
          frozenReportPath,
        }),
      ).rejects.toThrow('Bundle report outputs must not overwrite the frozen report.');
      const outputPath = join(directory, 'bundle-report.json');
      await expect(
        writeBundleReportArtifacts(frozen, {
          reportPath: outputPath,
          comparisonPath: outputPath,
          frozenReportPath,
        }),
      ).rejects.toThrow('Bundle report and comparison output paths must be distinct.');
      const realDirectory = join(directory, 'real');
      const aliasDirectory = join(directory, 'alias');
      await mkdir(realDirectory);
      await symlink(realDirectory, aliasDirectory, 'dir');
      await expect(
        writeBundleReportArtifacts(frozen, {
          reportPath: join(realDirectory, 'aliased-artifact.json'),
          comparisonPath: join(aliasDirectory, 'aliased-artifact.json'),
          frozenReportPath,
        }),
      ).rejects.toThrow('Bundle report and comparison output paths must be distinct.');
    });
  });

  it('leaves existing artifacts untouched when comparison preparation fails', async () => {
    await withTemporaryDirectory(async (directory) => {
      const frozenReportPath = join(directory, 'frozen-bundle-report.json');
      const reportPath = join(directory, 'bundle-report.json');
      const comparisonPath = join(directory, 'bundle-report-comparison.json');
      await writeFile(frozenReportPath, '{"schemaVersion":2}\n', 'utf8');
      await writeFile(reportPath, 'previous candidate\n', 'utf8');
      await writeFile(comparisonPath, 'previous comparison\n', 'utf8');

      await expect(
        writeBundleReportArtifacts(
          report(fixtureFiles({ changedMain: true }), '2026-08-13T00:00:00.000Z'),
          { reportPath, comparisonPath, frozenReportPath },
        ),
      ).rejects.toThrow('must use schema version 3');
      expect(await readFile(reportPath, 'utf8')).toBe('previous candidate\n');
      expect(await readFile(comparisonPath, 'utf8')).toBe('previous comparison\n');
    });
  });

  it('removes stale comparison evidence from a successful plain report run', async () => {
    await withTemporaryDirectory(async (directory) => {
      const frozenReportPath = join(directory, 'frozen-bundle-report.json');
      const reportPath = join(directory, 'bundle-report.json');
      const comparisonPath = join(directory, 'bundle-report-comparison.json');
      const candidate = report(fixtureFiles(), '2026-08-13T00:00:00.000Z');
      await writeFile(frozenReportPath, `${JSON.stringify(candidate)}\n`, 'utf8');
      await writeBundleReportArtifacts(candidate, {
        reportPath,
        comparisonPath,
        frozenReportPath,
      });

      await writeBundleReportArtifacts(candidate, { reportPath, comparisonPath });

      await expect(readFile(comparisonPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('rejects malformed and internally inconsistent schema-v3 frozen reports', async () => {
    await withTemporaryDirectory(async (directory) => {
      const frozenReportPath = join(directory, 'frozen-bundle-report.json');
      const reportPath = join(directory, 'bundle-report.json');
      const comparisonPath = join(directory, 'bundle-report-comparison.json');
      const candidate = report(fixtureFiles(), '2026-08-13T00:00:00.000Z');
      const options = { reportPath, comparisonPath, frozenReportPath };
      await writeFile(frozenReportPath, '{"schemaVersion":3}\n', 'utf8');

      await expect(writeBundleReportArtifacts(candidate, options)).rejects.toThrow(
        'entries must be a non-empty array',
      );

      const inconsistent = structuredClone(candidate);
      inconsistent.precache.rawBytes += 1;
      await writeFile(frozenReportPath, `${JSON.stringify(inconsistent)}\n`, 'utf8');
      await expect(writeBundleReportArtifacts(candidate, options)).rejects.toThrow(
        'precache.rawBytes does not equal its file total',
      );
    });
  });

  it('rejects frozen entry graphs that are not a disjoint eager and lazy union', async () => {
    await withTemporaryDirectory(async (directory) => {
      const frozenReportPath = join(directory, 'frozen-bundle-report.json');
      const options = {
        frozenReportPath,
        reportPath: join(directory, 'bundle-report.json'),
        comparisonPath: join(directory, 'bundle-report-comparison.json'),
      };
      const candidate = report(fixtureFiles(), '2026-08-13T00:00:00.000Z');
      const updateTotals = (graph: BundleGraphReport): void => {
        for (const metric of ['rawBytes', 'gzipBytes', 'brotliBytes'] as const) {
          graph[metric] = graph.files.reduce((total, file) => total + file[metric], 0);
        }
      };
      const overlapping = structuredClone(candidate);
      const overlappingMain = required(
        overlapping.entries.find((entry) => entry.entry === 'main'),
        'overlapping main entry',
      );
      overlappingMain.lazy.files.push(required(overlappingMain.eager.files.at(0), 'eager file'));
      overlappingMain.lazy.files.sort((left, right) => left.path.localeCompare(right.path));
      updateTotals(overlappingMain.lazy);
      await writeFile(frozenReportPath, `${JSON.stringify(overlapping)}\n`, 'utf8');
      await expect(writeBundleReportArtifacts(candidate, options)).rejects.toThrow(
        'eager and lazy graphs must be disjoint',
      );

      const incomplete = structuredClone(candidate);
      const incompleteMain = required(
        incomplete.entries.find((entry) => entry.entry === 'main'),
        'incomplete main entry',
      );
      incompleteMain.complete.files.pop();
      updateTotals(incompleteMain.complete);
      incompleteMain.rawBytes = incompleteMain.complete.rawBytes;
      incompleteMain.gzipBytes = incompleteMain.complete.gzipBytes;
      incompleteMain.brotliBytes = incompleteMain.complete.brotliBytes;
      await writeFile(frozenReportPath, `${JSON.stringify(incomplete)}\n`, 'utf8');
      await expect(writeBundleReportArtifacts(candidate, options)).rejects.toThrow(
        'complete graph must equal its eager and lazy union',
      );
    });
  });

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
    expect(comparison.changed.map((file) => file.path)).toEqual([
      'assets/main.js',
      'manifest.json',
      'sw.js',
    ]);
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

  it('counts a same-size replacement as N-1 update bytes', () => {
    const before = report(fixtureFiles(), '2026-08-12T00:00:00.000Z');
    const after = report(fixtureFiles({ changedMain: true }), '2026-08-13T00:00:00.000Z');
    const comparison = compareBundleReports(before, after);
    const replacement = required(comparison.changed.at(0), 'changed file');

    expect(comparison.rawBytes).toBe(0);
    expect(comparison.updateBytes).toEqual({
      rawBytes: replacement.after.rawBytes,
      gzipBytes: replacement.after.gzipBytes,
      brotliBytes: replacement.after.brotliBytes,
    });
  });

  it('reports unchanged files moving between eager and lazy entry graphs', () => {
    const files = fixtureFiles();
    const eagerDialogManifest: ViteManifest = {
      ...manifest,
      'index.html': {
        ...required(manifest['index.html'], 'main manifest entry'),
        imports: ['_shared.js', 'src/Dialog.tsx'],
        dynamicImports: ['src/viewer/viewer-application.tsx'],
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
