import { describe, expect, it } from 'vitest';
import {
  editorPrecacheFiles,
  embedOnlyFiles,
  manifestInstallIconFiles,
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
  it('derives fingerprinted install assets from the web app manifest', () => {
    expect(installIcons).toEqual([
      'icons/app-icon-a1b2c3d4e5f6-192.png',
      'icons/app-icon-a1b2c3d4e5f6.svg',
      'icons/app-icon-maskable-a1b2c3d4e5f6-512.png',
    ]);
  });

  it('walks static and lazy editor imports into the offline graph', () => {
    expect(editorPrecacheFiles(manifest, installIcons)).toEqual([
      'apple-touch-icon.png',
      'assets/dialog-icon.svg',
      'assets/dialog.js',
      'assets/main.css',
      'assets/main.js',
      'assets/shared.css',
      'assets/shared.js',
      'favicon-16x16.png',
      'favicon-32x32.png',
      'favicon-dark-16x16.png',
      'favicon-dark-32x32.png',
      'favicon.svg',
      'icons/app-icon-a1b2c3d4e5f6-192.png',
      'icons/app-icon-a1b2c3d4e5f6.svg',
      'icons/app-icon-maskable-a1b2c3d4e5f6-512.png',
      'index.html',
      'manifest.json',
    ]);
  });

  it('excludes only assets unique to the embed graph', () => {
    expect(embedOnlyFiles(manifest, installIcons)).toEqual(['assets/embed.js', 'embed.html']);
  });

  it('reports missing manifest icons and accidentally cached embed assets', () => {
    const expected = editorPrecacheFiles(manifest, installIcons);
    const precached = expected
      .filter((file) => file !== 'icons/app-icon-a1b2c3d4e5f6.svg')
      .concat('assets/embed.js');

    expect(verifyPrecacheOutput({ manifest, installIcons, precached })).toEqual([
      'editor asset is not precached: icons/app-icon-a1b2c3d4e5f6.svg',
      'embed-only asset is precached: assets/embed.js',
    ]);
  });
});
