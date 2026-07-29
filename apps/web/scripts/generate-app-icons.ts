#!/usr/bin/env tsx

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { LVBT } from '@transitmapper/core/style/lvbtBrand';
import {
  appIconPng,
  appIconSvg,
  appleTouchIconPng,
  type AppIconKind,
  type AppIconTheme,
} from './app-icon';

const PUBLIC_DIRECTORY = resolve(import.meta.dirname, '../public');
const OPEN_GRAPH_PATH = resolve(PUBLIC_DIRECTORY, 'og-image.png');
const CHECK_ONLY = process.argv.includes('--check');

interface RasterAsset {
  name: string;
  size: number;
  kind: AppIconKind;
  theme: Exclude<AppIconTheme, 'adaptive'>;
}

const RASTER_ASSETS: RasterAsset[] = [
  { name: 'favicon-16x16.png', size: 16, kind: 'regular', theme: 'light' },
  { name: 'favicon-32x32.png', size: 32, kind: 'regular', theme: 'light' },
  { name: 'favicon-dark-16x16.png', size: 16, kind: 'regular', theme: 'dark' },
  { name: 'favicon-dark-32x32.png', size: 32, kind: 'regular', theme: 'dark' },
  { name: 'icon-192.png', size: 192, kind: 'regular', theme: 'light' },
  { name: 'icon-512.png', size: 512, kind: 'regular', theme: 'light' },
  { name: 'icon-maskable-192.png', size: 192, kind: 'maskable', theme: 'light' },
  { name: 'icon-maskable-512.png', size: 512, kind: 'maskable', theme: 'light' },
];

interface GeneratedAsset {
  name: string;
  contents: Buffer;
}

async function generatedAssets(): Promise<GeneratedAsset[]> {
  const assets: GeneratedAsset[] = [
    {
      name: 'favicon.svg',
      contents: Buffer.from(appIconSvg({ kind: 'regular', theme: 'adaptive' })),
    },
    {
      name: 'icon.svg',
      contents: Buffer.from(appIconSvg({ kind: 'regular', theme: 'adaptive' })),
    },
    {
      name: 'icon-maskable.svg',
      contents: Buffer.from(appIconSvg({ kind: 'maskable', theme: 'adaptive' })),
    },
  ];

  for (const asset of RASTER_ASSETS) {
    assets.push({
      name: asset.name,
      contents: await appIconPng(asset),
    });
  }

  assets.push({
    name: 'apple-touch-icon.png',
    contents: await appleTouchIconPng(180),
  });

  return assets;
}

/**
 * The generic social card predates the asset generator and has no editable
 * source. Clear only its obsolete mark, then composite the generated light
 * icon into the same reserved area. Re-running this operation is idempotent:
 * the clear plate removes either the legacy mark or the previous generated
 * icon before placing the current one.
 */
async function generatedOpenGraphImage(): Promise<Buffer> {
  const source = await readFile(OPEN_GRAPH_PATH);
  const icon = await appIconPng({ kind: 'regular', theme: 'light', size: 96 });

  return sharp(source)
    .composite([
      {
        input: {
          create: {
            width: 128,
            height: 150,
            channels: 4,
            background: LVBT.light.surface,
          },
        },
        left: 84,
        top: 216,
      },
      { input: icon, left: 100, top: 241 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function verifyOrWrite(path: string, expected: Buffer): Promise<boolean> {
  if (!CHECK_ONLY) {
    await writeFile(path, expected);
    return true;
  }

  const actual = await readFile(path).catch(() => null);
  return actual?.equals(expected) === true;
}

async function main(): Promise<void> {
  const stale: string[] = [];
  for (const asset of await generatedAssets()) {
    const path = resolve(PUBLIC_DIRECTORY, asset.name);
    if (!(await verifyOrWrite(path, asset.contents))) stale.push(asset.name);
  }

  const openGraph = await generatedOpenGraphImage();
  if (!(await verifyOrWrite(OPEN_GRAPH_PATH, openGraph))) stale.push('og-image.png');

  if (stale.length > 0) {
    throw new Error(
      `Generated app icon assets are stale: ${stale.join(', ')}. Run pnpm --filter @transitmapper/web generate:icons.`,
    );
  }

  console.log(
    CHECK_ONLY
      ? 'Generated app icon assets are current.'
      : 'Generated theme-aware app icon assets.',
  );
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
