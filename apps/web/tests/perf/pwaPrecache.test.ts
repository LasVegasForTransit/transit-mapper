import { describe, expect, it } from 'vitest';
import {
  editorAdaptiveFiles,
  editorPrecacheFiles,
  embedOnlyFiles,
  manifestInstallIconFiles,
  referencedBuildAssetFiles,
  verifyPrecacheOutput,
  type BuildManifest,
  type WebAppManifest,
} from '../../src/perf/pwaPrecache';

const manifest: BuildManifest = {
  'index.html': {
    file: 'assets/main.js',
    isEntry: true,
    name: 'main',
    imports: ['_shared.js'],
    dynamicImports: ['src/Dialog.tsx'],
    css: ['assets/main.css'],
  },
  'embed.html': {
    file: 'assets/embed.js',
    isEntry: true,
    name: 'embed',
    imports: ['_shared.js'],
  },
  '_shared.js': {
    file: 'assets/shared.js',
    css: ['assets/shared.css'],
  },
  'src/Dialog.tsx': {
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

  it('precaches only the static editor shell on first install', () => {
    expect(editorPrecacheFiles(manifest, installIcons)).toEqual([
      'assets/main.css',
      'assets/main.js',
      'assets/shared.css',
      'assets/shared.js',
      'favicon.svg',
      'index.html',
      'manifest.json',
    ]);
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
    const expected = editorPrecacheFiles(manifest, installIcons);
    const precached = expected
      .filter((file) => file !== 'assets/main.js')
      .concat('assets/dialog.js', 'assets/embed.js');

    expect(verifyPrecacheOutput({ manifest, installIcons, precached })).toEqual([
      'essential editor asset is not precached: assets/main.js',
      'adaptive editor asset is precached during first install: assets/dialog.js',
      'embed-only asset is precached: assets/embed.js',
    ]);
  });
});
