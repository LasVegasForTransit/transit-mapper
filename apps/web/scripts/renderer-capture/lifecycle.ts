import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { StyleSpecification } from 'maplibre-gl';
import { basemapStyleForScheme, localBlankStyleForScheme } from '../../src/map/mapTheme';

export function rendererSeedPageUrl(previewUrl: string): string {
  return `${previewUrl.replace(/\/$/, '')}/favicon.svg`;
}

export function rendererBasemapStyleForUrl(url: string): StyleSpecification | undefined {
  if (url === basemapStyleForScheme('light')) return localBlankStyleForScheme('light');
  if (url === basemapStyleForScheme('dark')) return localBlankStyleForScheme('dark');
  return undefined;
}

/** A phase is a reproducible snapshot, so a rerun starts from an empty exact
 * phase directory. Earlier phases live beside it and remain untouched. */
export async function prepareRendererCaptureOutput(
  outputDirectory: string,
  artifactRoot: string,
): Promise<void> {
  const exactOutput = resolve(outputDirectory);
  const exactRoot = resolve(artifactRoot);
  if (exactOutput === exactRoot || dirname(exactOutput) !== exactRoot) {
    throw new Error('Renderer capture output must be a direct child of its artifact root.');
  }
  await rm(exactOutput, { recursive: true, force: true });
  await mkdir(resolve(exactOutput, 'images'), { recursive: true });
}

export function rendererCaptureDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function rendererSourceIsDirty(porcelainStatus: string): boolean {
  return porcelainStatus.trim().length > 0;
}
