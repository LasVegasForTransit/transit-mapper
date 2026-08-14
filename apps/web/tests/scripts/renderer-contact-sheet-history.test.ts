import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  completeRendererEvidenceFiles,
  previousRendererPhase,
  successfulRendererPhaseDirectories,
} from '../../scripts/renderer-capture/capture-contact-sheet';
import { rendererCaptureDigest } from '../../scripts/renderer-capture/lifecycle';
import {
  CURRENT_RENDERER_CAPTURE_SOURCE as CURRENT_SOURCE,
  LEGACY_RENDERER_CAPTURE_SOURCE as LEGACY_SOURCE,
  writeRendererLodAcceptance,
} from '../support/renderer-contact-sheet.test';

async function writeCompletePhase(
  root: string,
  phase: string,
  source: typeof CURRENT_SOURCE | typeof LEGACY_SOURCE,
  basemap: 'local-blank-v1' | 'local-blank-v2',
): Promise<void> {
  const captures = completeRendererEvidenceFiles(phase);
  await mkdir(join(root, phase, 'images'), { recursive: true });
  await Promise.all(
    captures.map((capture) => writeFile(join(root, phase, capture.file), capture.id)),
  );
  await writeFile(
    join(root, phase, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      phase,
      complete: true,
      selection: { profile: 'all', theme: 'all' },
      source,
      basemap,
      captures: captures.map((capture) => ({
        ...capture,
        sha256: rendererCaptureDigest(Buffer.from(capture.id)),
      })),
    }),
  );
}

describe('renderer contact sheet history', () => {
  it('chooses history only from complete numbered phases with required provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renderer-history-'));
    const current = join(root, '03-junctions');
    await Promise.all([
      writeCompletePhase(root, '00-baseline', LEGACY_SOURCE, 'local-blank-v1'),
      writeCompletePhase(root, '01-lod', CURRENT_SOURCE, 'local-blank-v2'),
      writeCompletePhase(root, '02-physical-geometry', CURRENT_SOURCE, 'local-blank-v2'),
      writeCompletePhase(root, '04-failed', CURRENT_SOURCE, 'local-blank-v2'),
      mkdir(join(root, 'debug'), { recursive: true }),
    ]);
    await writeRendererLodAcceptance(join(root, '01-lod'));
    await writeFile(join(root, '02-physical-geometry', 'capture-error.json'), '{}');
    await writeFile(join(root, '04-failed', 'capture-error.json'), '{}');

    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([
      '00-baseline',
      '01-lod',
    ]);
  });

  it('rejects empty and diagnostic manifests from canonical phase history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renderer-history-'));
    const current = join(root, '03-junctions');
    await Promise.all([
      mkdir(join(root, '00-baseline'), { recursive: true }),
      mkdir(join(root, '01-lod'), { recursive: true }),
    ]);
    await writeFile(
      join(root, '00-baseline', 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        phase: '00-baseline',
        complete: true,
        selection: { profile: 'all', theme: 'all' },
        source: LEGACY_SOURCE,
        basemap: 'local-blank-v1',
        captures: [],
      }),
    );
    await writeFile(
      join(root, '01-lod', 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        phase: '01-lod',
        complete: false,
        selection: { profile: 'mobile', theme: 'dark' },
        source: CURRENT_SOURCE,
        basemap: 'local-blank-v2',
        captures: [{ id: 'subset', file: 'images/subset.png', sha256: '0'.repeat(64) }],
      }),
    );
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([]);
  });

  it('rejects aliased, escaping, and hash-mismatched evidence paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renderer-history-'));
    const current = join(root, '01-lod');
    const phase = '00-baseline';
    const directory = join(root, phase);
    await mkdir(join(directory, 'images'), { recursive: true });
    await writeFile(join(directory, 'images', 'shared.png'), 'shared');
    const files = completeRendererEvidenceFiles(phase);
    const manifest = {
      schemaVersion: 1,
      phase,
      complete: true,
      selection: { profile: 'all', theme: 'all' },
      source: LEGACY_SOURCE,
      basemap: 'local-blank-v1',
      captures: files.map(({ id }) => ({
        id,
        file: 'images/shared.png',
        sha256: rendererCaptureDigest(Buffer.from('shared')),
      })),
    };
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([]);

    manifest.captures = files.map(({ id, file }) => ({
      id,
      file: id === files[0]?.id ? 'images/../../escape.png' : file,
      sha256: rendererCaptureDigest(Buffer.from(id)),
    }));
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([]);

    await Promise.all(files.map(({ id, file }) => writeFile(join(directory, file), id)));
    manifest.captures = files.map(({ id, file }) => ({
      id,
      file,
      sha256: id === files[0]?.id ? '0'.repeat(64) : rendererCaptureDigest(Buffer.from(id)),
    }));
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([]);
  });

  it('requires current provenance and the LOD appendix for the 01-lod phase', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renderer-history-'));
    const phase = '01-lod';
    const current = join(root, '02-geometry');
    await writeCompletePhase(root, phase, LEGACY_SOURCE, 'local-blank-v1');

    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([]);

    await writeCompletePhase(root, phase, CURRENT_SOURCE, 'local-blank-v2');
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([]);

    await writeRendererLodAcceptance(join(root, phase));
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual(['01-lod']);
  });

  it('requires current source and basemap provenance for every post-LOD phase', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renderer-history-'));
    const phase = '02-geometry';
    const current = join(root, '03-junctions');
    await writeCompletePhase(root, phase, CURRENT_SOURCE, 'local-blank-v2');
    const manifestPath = join(root, phase, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, source: { ...CURRENT_SOURCE, contentSha256: 'bad' } }),
    );
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([]);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, basemap: 'local-blank-v1' }));
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([]);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual(['02-geometry']);
  });

  it('uses the highest complete phase strictly before the current ordinal', () => {
    const phases = ['00-baseline', '01-lod', '02-physical-geometry', '04-network'];
    expect(previousRendererPhase('01-lod', phases)).toBe('00-baseline');
    expect(previousRendererPhase('03-junctions', phases)).toBe('02-physical-geometry');
    expect(previousRendererPhase('01-lod', [...phases, '06-final'])).toBe('00-baseline');
  });
});
