import { describe, expect, it } from 'vitest';
import {
  createAdaptiveAssetManifest,
  discoverReferencedBuildAssets,
  filterEssentialPrecacheEntries,
} from '../../scripts/adaptive-assets';
import { buildManifestFixture, createBuildManifestFixture } from '../support/build-manifest.test';

const manifest = createBuildManifestFixture();
const { files, offlineRuntimeFiles } = buildManifestFixture;

describe('adaptive offline build assets', () => {
  it('filters Workbox input to the exact static editor shell', () => {
    const entries = [
      { url: files.optionalFeatureScript, size: 40, revision: 'optional-feature' },
      {
        url: offlineRuntimeFiles[1],
        size: 100,
        revision: 'projection-worker',
      },
      {
        url: files.editorApplicationScript,
        size: 100,
        revision: 'editor-application',
      },
      { url: files.mainScript, size: 100, revision: 'main' },
      { url: files.offlineEditorScript, size: 100, revision: 'offline-editor' },
      { url: files.sharedScript, size: 50, revision: 'shared' },
      { url: 'favicon.svg', size: 10, revision: 'favicon' },
      { url: 'index.html', size: 20, revision: 'document' },
      { url: 'manifest.json', size: 20, revision: 'manifest' },
    ];

    expect(
      filterEssentialPrecacheEntries(entries, manifest).map((entry) => entry.revision),
    ).toEqual([
      'projection-worker',
      'editor-application',
      'main',
      'offline-editor',
      'shared',
      'favicon',
      'document',
      'manifest',
    ]);
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
