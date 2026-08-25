import { describe, expect, it } from 'vitest';
import {
  createAdaptiveAssetManifest,
  discoverReferencedBuildAssets,
  filterEssentialPrecacheEntries,
} from '../../scripts/adaptive-assets';
import type { BuildManifest } from '../../src/perf/pwaPrecache';

const manifest: BuildManifest = {
  'manifest-node:main': {
    file: 'assets/main.js',
    name: 'main',
    isEntry: true,
    imports: ['_shared.js'],
    dynamicImports: ['manifest-node:optional-feature'],
    css: ['assets/main.css'],
  },
  '_shared.js': {
    file: 'assets/shared.js',
    css: ['assets/shared.css'],
  },
  'manifest-node:optional-feature': {
    file: 'assets/dialog.js',
    assets: ['assets/dialog-icon.svg'],
  },
  'offline-editor-entry': {
    file: 'assets/offline-editor.js',
    name: 'offline-editor',
    isEntry: true,
    imports: ['_shared.js'],
  },
  'manifest-node:embed': {
    file: 'assets/embed.js',
    name: 'embed',
    isEntry: true,
    imports: ['_shared.js'],
  },
};

describe('adaptive offline build assets', () => {
  it('filters Workbox input to the exact static editor shell', () => {
    const entries = [
      { url: 'assets/dialog.js', size: 40, revision: 'dialog' },
      {
        url: 'assets/feature-projection-worker-entry-a1b2c3.js',
        size: 100,
        revision: 'projection-worker',
      },
      { url: 'assets/main.js', size: 100, revision: 'main' },
      { url: 'assets/offline-editor.js', size: 100, revision: 'offline-editor' },
      { url: 'assets/shared.js', size: 50, revision: 'shared' },
      { url: 'favicon.svg', size: 10, revision: 'favicon' },
      { url: 'index.html', size: 20, revision: 'document' },
      { url: 'manifest.json', size: 20, revision: 'manifest' },
    ];

    expect(filterEssentialPrecacheEntries(entries, manifest)).toEqual(entries.slice(1));
  });

  it('discovers Worker assets without pulling them into first install', async () => {
    const sourceByFile = new Map([
      ['assets/main.js', 'new Worker(new URL("/assets/storage-worker.js", import.meta.url))'],
      [
        'assets/storage-worker.js',
        'new Worker(new URL("/assets/nested-worker.js", import.meta.url))',
      ],
      ['assets/nested-worker.js', 'self.onmessage=()=>undefined'],
    ]);

    await expect(
      discoverReferencedBuildAssets(['assets/main.js'], (file) =>
        Promise.resolve(sourceByFile.get(file) ?? ''),
      ),
    ).resolves.toEqual(['assets/main.js', 'assets/nested-worker.js', 'assets/storage-worker.js']);
  });

  it('emits a sorted versioned manifest with raw byte ceilings', () => {
    expect(
      createAdaptiveAssetManifest({
        buildId: '0123456789abcdef0123456789abcdef01234567',
        files: ['assets/worker.js', 'assets/dialog.js'],
        sizeOf: (file) => (file.endsWith('worker.js') ? 60_000 : 4_000),
      }),
    ).toEqual({
      schemaVersion: 1,
      buildId: '0123456789abcdef0123456789abcdef01234567',
      assets: [
        { url: '/assets/dialog.js', bytes: 4_000 },
        { url: '/assets/worker.js', bytes: 60_000 },
      ],
    });
  });
});
