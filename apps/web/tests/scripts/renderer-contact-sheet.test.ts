import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rendererContactSheetHtml } from '../../scripts/renderer-capture/contact-sheet';
import {
  completeRendererEvidenceFiles,
  previousRendererPhase,
  successfulRendererPhaseDirectories,
} from '../../scripts/renderer-capture/capture-contact-sheet';
import { rendererCaptureDigest } from '../../scripts/renderer-capture/lifecycle';

describe('renderer contact sheets', () => {
  it('groups captures in deterministic baseline, previous, current, difference order', () => {
    const html = rendererContactSheetHtml({
      phase: '02-geometry',
      captures: [
        {
          id: 'desktop-light-infrastructure-overview',
          comparisons: [
            { label: 'Baseline', path: 'baseline.png' },
            { label: 'Previous', path: 'previous.png' },
            { label: 'Current', path: 'current.png' },
            { label: 'Difference', path: 'difference.png' },
          ],
        },
      ],
    });

    expect(html.indexOf('Baseline')).toBeLessThan(html.indexOf('Previous'));
    expect(html.indexOf('Previous')).toBeLessThan(html.indexOf('Current'));
    expect(html.indexOf('Current')).toBeLessThan(html.indexOf('Difference'));
    expect(html).toContain('Renderer evidence: 02-geometry');
  });

  it('chooses history only from complete numbered phase manifests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renderer-history-'));
    const current = join(root, '03-junctions');
    for (const phase of ['00-baseline', '01-lod', '02-physical-geometry', 'debug', '04-failed']) {
      await mkdir(join(root, phase), { recursive: true });
    }
    const writeManifest = async (
      phase: string,
      complete: boolean,
      captures = completeRendererEvidenceFiles(phase),
    ) => {
      await mkdir(join(root, phase, 'images'), { recursive: true });
      await Promise.all(
        captures.map((capture) => writeFile(join(root, phase, capture.file), capture.id)),
      );
      await writeFile(
        join(root, phase, 'manifest.json'),
        JSON.stringify({
          schemaVersion: 1,
          phase,
          complete,
          selection: { profile: complete ? 'all' : 'mobile', theme: 'all' },
          captures: captures.map((capture) => ({
            ...capture,
            sha256: rendererCaptureDigest(Buffer.from(capture.id)),
          })),
        }),
      );
    };
    await Promise.all([
      writeManifest('00-baseline', true),
      writeManifest('01-lod', true),
      writeManifest('02-physical-geometry', true),
      writeManifest('debug', true),
      writeManifest('04-failed', true),
    ]);
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

  it('uses the highest complete phase strictly before the current ordinal', () => {
    const phases = ['00-baseline', '01-lod', '02-physical-geometry', '04-network'];

    expect(previousRendererPhase('01-lod', phases)).toBe('00-baseline');
    expect(previousRendererPhase('03-junctions', phases)).toBe('02-physical-geometry');
    expect(previousRendererPhase('01-lod', [...phases, '06-final'])).toBe('00-baseline');
  });
});
