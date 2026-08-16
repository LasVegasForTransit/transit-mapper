import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepareRendererCaptureOutput,
  rendererCaptureDigest,
  rendererBasemapStyleForUrl,
  rendererSeedPageUrl,
  rendererSourceContentDigest,
  rendererSourceIsDirty,
} from '../../scripts/renderer-capture/lifecycle';

describe('renderer capture storage lifecycle', () => {
  it('seeds from a same-origin static page that cannot hold the app database open', () => {
    expect(rendererSeedPageUrl('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173/favicon.svg');
  });

  it('hashes captured bytes for like-for-like provenance', () => {
    expect(rendererCaptureDigest(Buffer.from('renderer pixels'))).toBe(
      'c0df82967a971e2894fdbdef872c9cdd664f860b389a3d817e59352371f516bd',
    );
  });

  it('treats untracked source as dirty provenance', () => {
    expect(rendererSourceIsDirty('?? apps/web/src/new-renderer.ts\n')).toBe(true);
    expect(rendererSourceIsDirty('')).toBe(false);
  });

  it('identifies the exact tracked and untracked source bytes independent of file order', () => {
    const revision = '0123456789abcdef0123456789abcdef01234567';
    const trackedDiff = Buffer.from('diff --git a/a.ts b/a.ts\n+changed\n');
    const untracked = [
      { path: 'packages/core/src/new.ts', bytes: Buffer.from('core') },
      { path: 'apps/web/src/new.ts', bytes: Buffer.from('web') },
    ];

    const digest = rendererSourceContentDigest(revision, trackedDiff, untracked);

    expect(digest).toBe('917e9e760943720b3b2b5bc67b3547fe53403ee889b0fc16dadf27e6811c9702');
    expect(rendererSourceContentDigest(revision, trackedDiff, [...untracked].reverse())).toBe(
      digest,
    );
    expect(rendererSourceContentDigest(revision, Buffer.from('different'), untracked)).not.toBe(
      digest,
    );
  });

  it('clears stale success, failure, and image files before a phase rerun', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renderer-capture-'));
    const output = join(root, '00-baseline');
    await prepareRendererCaptureOutput(output, root);
    await writeFile(join(output, 'capture-error.json'), '{}');
    await writeFile(join(output, 'manifest.json'), '{}');
    await writeFile(join(output, 'images', 'stale.png'), 'stale');

    await prepareRendererCaptureOutput(output, root);

    expect(await readdir(output)).toEqual(['images']);
    expect(await readdir(join(output, 'images'))).toEqual([]);
  });

  it('refuses to clean anything except a direct child of the renderer artifact root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renderer-capture-'));
    await expect(prepareRendererCaptureOutput(join(root, '..', 'outside'), root)).rejects.toThrow(
      'must be a direct child',
    );
    await expect(prepareRendererCaptureOutput(root, root)).rejects.toThrow(
      'must be a direct child',
    );
  });

  it('replaces both remote basemap styles with deterministic source-free styles', () => {
    expect(
      rendererBasemapStyleForUrl('https://tiles.openfreemap.org/styles/positron'),
    ).toMatchObject({ version: 8, sources: {} });
    expect(rendererBasemapStyleForUrl('https://tiles.openfreemap.org/styles/dark')).toMatchObject({
      version: 8,
      sources: {},
    });
    expect(rendererBasemapStyleForUrl('https://example.com/tiles')).toBeUndefined();
  });
});
