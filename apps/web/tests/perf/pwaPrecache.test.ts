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
  type WebAppManifest,
} from '../../src/perf/pwaPrecache';
import {
  buildManifestFixture,
  createBuildManifestFixture,
  createOfflineEditorManifestFixture,
} from '../support/build-manifest.test';

const manifest = createBuildManifestFixture();
const { files, keys, offlineRuntimeFiles } = buildManifestFixture;

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
const offlineEditorManifest = createOfflineEditorManifestFixture();

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
        files.mainStyles,
        files.mainScript,
        files.sharedStyles,
        files.sharedScript,
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

  it('precaches the declared offline runtime and its static closure', () => {
    const precached = new Set(
      editorOfflinePrecacheFiles(offlineEditorManifest, installIcons, offlineRuntimeFiles),
    );

    expect(precached.has(keys.offlineEditor)).toBe(false);
    expect(precached.has(files.offlineEditorScript)).toBe(true);
    expect(precached.has(files.offlineRuntimeScript)).toBe(true);
    expect(precached.has(files.offlineRuntimeStyles)).toBe(true);
    expect(precached.has(files.nestedOfflineRuntimeScript)).toBe(true);
    expect(precached.has(files.optionalOfflineFeatureScript)).toBe(false);
  });

  it('retains the lazy editor host required by the cached application shell', () => {
    const precached = editorOfflinePrecacheFiles(
      offlineEditorManifest,
      installIcons,
      offlineRuntimeFiles,
    );
    const adaptive = editorAdaptiveFiles(offlineEditorManifest, installIcons, offlineRuntimeFiles);
    expect(precached).toContain(files.editorApplicationScript);
    expect(adaptive).not.toContain(files.editorApplicationScript);
  });

  it('classifies lazy features and install artwork as adaptive assets', () => {
    expect(editorAdaptiveFiles(manifest, installIcons)).toEqual(
      [
        'apple-touch-icon.png',
        files.optionalFeatureAsset,
        files.optionalFeatureScript,
        'favicon-16x16.png',
        'favicon-32x32.png',
        'favicon-dark-16x16.png',
        'favicon-dark-32x32.png',
        ...installIcons,
      ].sort(),
    );
  });

  it('excludes only assets unique to the embed graph', () => {
    expect(embedOnlyFiles(manifest, installIcons)).toEqual([files.embedScript, 'embed.html']);
  });

  it('reports a missing shell asset and any eager adaptive or embed asset', () => {
    const expected = editorOfflinePrecacheFiles(manifest, installIcons, []);
    const precached = expected
      .filter((file) => file !== files.mainScript)
      .concat(files.optionalFeatureScript, files.embedScript);

    expect(verifyPrecacheOutput({ manifest, installIcons, precached })).toEqual([
      `essential editor asset is not precached: ${files.mainScript}`,
      `adaptive editor asset is precached during first install: ${files.optionalFeatureScript}`,
      `embed-only asset is precached: ${files.embedScript}`,
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
    ).toEqual([`essential editor asset is not precached: ${offlineRuntimeFiles[0]}`]);
  });
});
