import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import {
  editorAdaptiveFiles,
  editorOfflinePrecacheFiles,
  editorPrecacheFiles,
  manifestInstallIconFiles,
  referencedBuildAssetFiles,
  type BuildManifest,
  type WebAppManifest,
} from '../src/perf/pwaPrecache';
import type { AdaptiveAssetManifest } from '../src/pwa/adaptive-cache-contract';

interface PrecacheEntry {
  url: string;
}

interface WorkboxPrecacheEntry extends PrecacheEntry {
  revision: string | null;
  integrity?: string;
  size: number;
}

interface CreateAdaptiveAssetManifestOptions {
  buildId: string;
  files: readonly string[];
  sizeOf: (file: string) => number;
}

interface WriteAdaptiveAssetManifestOptions {
  buildId: string;
  distDirectory: string;
}

type SourceReader = (file: string) => Promise<string>;

const BUILD_ID = /^[A-Za-z0-9._+-]{1,80}$/;
const TEXT_BUILD_ASSET = /\.(?:css|js)$/;

export function filterEssentialPrecacheEntries<T extends PrecacheEntry>(
  entries: readonly T[],
  manifest: BuildManifest,
): T[] {
  const essential = new Set(
    editorOfflinePrecacheFiles(
      manifest,
      [],
      entries.map((entry) => entry.url),
    ),
  );
  return entries.filter((entry) => essential.has(entry.url.replace(/^\/+/, '')));
}

/** Workbox discovers broadly so new static dependencies cannot be omitted,
 * then this transform resolves Vite's actual entry graph and keeps only the
 * eager editor shell. The post-build verifier independently checks the same
 * invariant against the generated service worker. */
export function createEssentialPrecacheTransform(manifestPath: string) {
  return async (entries: WorkboxPrecacheEntry[]) => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BuildManifest;
    return {
      manifest: filterEssentialPrecacheEntries(entries, manifest),
      warnings: [],
    };
  };
}

export async function discoverReferencedBuildAssets(
  initialFiles: readonly string[],
  readSource: SourceReader,
): Promise<string[]> {
  const discovered = new Set(initialFiles);
  const pending = initialFiles.filter((file) => TEXT_BUILD_ASSET.test(file));
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file) continue;
    for (const referenced of referencedBuildAssetFiles(await readSource(file))) {
      if (discovered.has(referenced)) continue;
      discovered.add(referenced);
      if (TEXT_BUILD_ASSET.test(referenced)) pending.push(referenced);
    }
  }
  return [...discovered].sort();
}

export function createAdaptiveAssetManifest({
  buildId,
  files,
  sizeOf,
}: CreateAdaptiveAssetManifestOptions): AdaptiveAssetManifest {
  if (!BUILD_ID.test(buildId)) throw new Error(`Invalid adaptive asset build ID: ${buildId}`);
  const assets = [...new Set(files)].sort().map((file) => {
    if (!file || file.startsWith('/') || file.includes('..')) {
      throw new Error(`Invalid adaptive asset path: ${file}`);
    }
    const bytes = sizeOf(file);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error(`Invalid adaptive asset size for ${file}: ${bytes}`);
    }
    return { url: `/${file}`, bytes };
  });
  return { schemaVersion: 1, buildId, assets };
}

async function writeAdaptiveAssetManifest({
  buildId,
  distDirectory,
}: WriteAdaptiveAssetManifestOptions): Promise<void> {
  const viteManifest = JSON.parse(
    await readFile(resolve(distDirectory, '.vite/manifest.json'), 'utf8'),
  ) as BuildManifest;
  const webAppManifest = JSON.parse(
    await readFile(resolve(distDirectory, 'manifest.json'), 'utf8'),
  ) as WebAppManifest;
  const installIcons = manifestInstallIconFiles(webAppManifest);
  const eager = editorPrecacheFiles(viteManifest, installIcons);
  const candidates = await discoverReferencedBuildAssets(
    [...eager, ...editorAdaptiveFiles(viteManifest, installIcons)],
    (file) => readFile(resolve(distDirectory, file), 'utf8'),
  );
  const essential = new Set(editorOfflinePrecacheFiles(viteManifest, installIcons, candidates));
  const editorFiles = [
    ...essential,
    ...editorAdaptiveFiles(viteManifest, installIcons, candidates),
  ];
  const reachable = await discoverReferencedBuildAssets(editorFiles, (file) =>
    readFile(resolve(distDirectory, file), 'utf8'),
  );
  const adaptive = reachable.filter((file) => !essential.has(file));
  const sizes = new Map<string, number>();
  await Promise.all(
    adaptive.map(async (file) => sizes.set(file, (await stat(resolve(distDirectory, file))).size)),
  );
  const output = createAdaptiveAssetManifest({
    buildId,
    files: adaptive,
    sizeOf: (file) => sizes.get(file) ?? -1,
  });
  await writeFile(
    resolve(distDirectory, 'adaptive-assets.json'),
    `${JSON.stringify(output)}\n`,
    'utf8',
  );
}

export function adaptiveAssetManifestPlugin(options: WriteAdaptiveAssetManifestOptions): Plugin {
  return {
    name: 'transitmapper-adaptive-assets',
    enforce: 'post',
    async closeBundle() {
      await writeAdaptiveAssetManifest(options);
    },
  };
}
