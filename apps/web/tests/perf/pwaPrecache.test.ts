import { describe, expect, it } from 'vitest';
import {
  editorAdaptiveFiles,
  editorOfflinePrecacheFiles,
  editorPrecacheFiles,
  embedOnlyFiles,
  manifestInstallIconFiles,
  OFFLINE_GLYPH_RANGE_FILES,
  referencedBuildAssetFiles,
  verifyPrecacheOutput,
  type BuildManifest,
  type WebAppManifest,
} from '../../src/perf/pwaPrecache';

const manifest: BuildManifest = {
  'manifest-node:main': {
    file: 'assets/main.js',
    isEntry: true,
    name: 'main',
    imports: ['_shared.js'],
    dynamicImports: ['_adaptive-feature.js'],
    css: ['assets/main.css'],
  },
  'manifest-node:embed': {
    file: 'assets/embed.js',
    isEntry: true,
    name: 'embed',
    imports: ['_shared.js'],
  },
  '_shared.js': {
    file: 'assets/shared.js',
    css: ['assets/shared.css'],
  },
  'offline-editor-entry': {
    file: 'assets/offline-editor.js',
    isEntry: true,
    name: 'offline-editor',
    imports: ['_shared.js'],
  },
  '_adaptive-feature.js': {
    file: 'assets/dialog.js',
    assets: ['assets/dialog-icon.svg'],
  },
};

const webAppManifest: WebAppManifest = {
  icons: [
    {
      src: '/icons/app-icon-a1b2c3d4e5f6.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any',
    },
    {
      src: '/icons/app-icon-a1b2c3d4e5f6-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    },
    {
      src: '/icons/app-icon-maskable-a1b2c3d4e5f6-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};

const installIcons = manifestInstallIconFiles(webAppManifest);
const offlineRuntimeFiles = [
  'assets/diagram-layout-worker-entry-a1b2c3.js',
  'assets/feature-projection-worker-entry-a1b2c3.js',
  'assets/storage-deserializer-worker-a1b2c3.js',
];

const offlineEditorEntryKey = 'offline-editor-entry';
const offlineEditorOutputs = {
  entry: 'emitted:offline-editor',
  runtime: 'emitted:runtime',
  runtimeStyles: 'emitted:runtime-styles',
  nestedRuntime: 'emitted:nested-runtime',
  optionalFeature: 'emitted:optional-feature',
} as const;

const offlineEditorManifest: BuildManifest = {
  ...manifest,
  [offlineEditorEntryKey]: {
    file: offlineEditorOutputs.entry,
    isEntry: true,
    name: 'offline-editor',
    imports: ['manifest-node:runtime'],
    dynamicImports: ['manifest-node:optional-feature'],
  },
  'manifest-node:runtime': {
    file: offlineEditorOutputs.runtime,
    css: [offlineEditorOutputs.runtimeStyles],
    imports: ['manifest-node:nested-runtime'],
  },
  'manifest-node:nested-runtime': {
    file: offlineEditorOutputs.nestedRuntime,
  },
  'manifest-node:optional-feature': {
    file: offlineEditorOutputs.optionalFeature,
  },
};

describe('PWA precache output', () => {
  it('keeps the complete extension for referenced WOFF2 assets', () => {
    expect(
      referencedBuildAssetFiles(
        "src:url('/assets/public-sans-latin-a1b2c3.woff2') format('woff2-variations')",
      ),
    ).toEqual(['assets/public-sans-latin-a1b2c3.woff2']);
  });

  it('derives fingerprinted install assets from the web app manifest', () => {
    expect(installIcons).toEqual([
      'icons/app-icon-a1b2c3d4e5f6-192.png',
      'icons/app-icon-a1b2c3d4e5f6.svg',
      'icons/app-icon-maskable-a1b2c3d4e5f6-512.png',
    ]);
  });

  it('precaches the editor shell and the three text ranges that render transit labels', () => {
    expect(OFFLINE_GLYPH_RANGE_FILES).toEqual([
      'glyphs/noto-sans-v1/Noto Sans Bold/0-255.pbf',
      'glyphs/noto-sans-v1/Noto Sans Regular/0-255.pbf',
      'glyphs/noto-sans-v1/Noto Sans Regular/9472-9727.pbf',
    ]);
    expect(editorPrecacheFiles(manifest, installIcons)).toEqual(
      [
        'assets/main.css',
        'assets/main.js',
        'assets/shared.css',
        'assets/shared.js',
        'favicon.svg',
        'index.html',
        'manifest.json',
        ...OFFLINE_GLYPH_RANGE_FILES,
      ].sort(),
    );
  });

  it('installs the workers that reconstruct a saved map offline', () => {
    const precached = editorOfflinePrecacheFiles(manifest, installIcons, offlineRuntimeFiles);
    const adaptive = editorAdaptiveFiles(manifest, installIcons, offlineRuntimeFiles);

    expect(offlineRuntimeFiles.every((file) => precached.includes(file))).toBe(true);
    expect(offlineRuntimeFiles.some((file) => adaptive.includes(file))).toBe(false);
  });

  it('precaches emitted files from the offline editor static graph', () => {
    const precached = new Set(
      editorOfflinePrecacheFiles(offlineEditorManifest, installIcons, offlineRuntimeFiles),
    );

    expect(precached.has(offlineEditorEntryKey)).toBe(false);
    expect(precached.has(offlineEditorOutputs.entry)).toBe(true);
    expect(precached.has(offlineEditorOutputs.runtime)).toBe(true);
    expect(precached.has(offlineEditorOutputs.runtimeStyles)).toBe(true);
    expect(precached.has(offlineEditorOutputs.nestedRuntime)).toBe(true);
    expect(precached.has(offlineEditorOutputs.optionalFeature)).toBe(false);
  });

  it('classifies lazy features and install artwork as adaptive assets', () => {
    expect(editorAdaptiveFiles(manifest, installIcons)).toEqual([
      'apple-touch-icon.png',
      'assets/dialog-icon.svg',
      'assets/dialog.js',
      'favicon-16x16.png',
      'favicon-32x32.png',
      'favicon-dark-16x16.png',
      'favicon-dark-32x32.png',
      'icons/app-icon-a1b2c3d4e5f6-192.png',
      'icons/app-icon-a1b2c3d4e5f6.svg',
      'icons/app-icon-maskable-a1b2c3d4e5f6-512.png',
    ]);
  });

  it('excludes only assets unique to the embed graph', () => {
    expect(embedOnlyFiles(manifest, installIcons)).toEqual(['assets/embed.js', 'embed.html']);
  });

  it('reports a missing shell asset and any eager adaptive or embed asset', () => {
    const expected = editorOfflinePrecacheFiles(manifest, installIcons, []);
    const precached = expected
      .filter((file) => file !== 'assets/main.js')
      .concat('assets/dialog.js', 'assets/embed.js');

    expect(verifyPrecacheOutput({ manifest, installIcons, precached })).toEqual([
      'essential editor asset is not precached: assets/main.js',
      'adaptive editor asset is precached during first install: assets/dialog.js',
      'embed-only asset is precached: assets/embed.js',
    ]);
  });

  it('reports a missing startup worker required by an offline reload', () => {
    const precached = editorOfflinePrecacheFiles(
      manifest,
      installIcons,
      offlineRuntimeFiles,
    ).filter((file) => file !== offlineRuntimeFiles[0]);

    expect(
      verifyPrecacheOutput({
        manifest,
        installIcons,
        precached,
        offlineRuntimeFiles,
      }),
    ).toEqual([
      'essential editor asset is not precached: assets/diagram-layout-worker-entry-a1b2c3.js',
    ]);
  });
});
