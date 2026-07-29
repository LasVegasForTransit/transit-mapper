import { describe, expect, it } from 'vitest';
import {
  editorPrecacheFiles,
  embedOnlyFiles,
  verifyPrecacheOutput,
  type BuildManifest,
} from './pwaPrecache';

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

describe('PWA precache output', () => {
  it('walks static and lazy editor imports into the offline graph', () => {
    expect(editorPrecacheFiles(manifest)).toEqual([
      'apple-touch-icon.png',
      'assets/dialog-icon.svg',
      'assets/dialog.js',
      'assets/main.css',
      'assets/main.js',
      'assets/shared.css',
      'assets/shared.js',
      'favicon-16x16.png',
      'favicon-32x32.png',
      'favicon.svg',
      'icon-192.png',
      'icon-512.png',
      'icon-maskable-192.png',
      'icon-maskable-512.png',
      'index.html',
      'manifest.json',
    ]);
  });

  it('excludes only assets unique to the embed graph', () => {
    expect(embedOnlyFiles(manifest)).toEqual(['assets/embed.js', 'embed.html']);
  });

  it('reports missing editor assets and accidentally cached embed assets', () => {
    const expected = editorPrecacheFiles(manifest);
    const precached = expected
      .filter((file) => file !== 'assets/dialog.js')
      .concat('assets/embed.js');

    expect(verifyPrecacheOutput({ manifest, precached })).toEqual([
      'editor asset is not precached: assets/dialog.js',
      'embed-only asset is precached: assets/embed.js',
    ]);
  });
});
