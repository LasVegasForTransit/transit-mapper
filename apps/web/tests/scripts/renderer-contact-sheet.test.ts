import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rendererContactSheetHtml } from '../../scripts/renderer-capture/contact-sheet';
import {
  rendererLodAcceptanceContactSheetAppendix,
  completeRendererEvidenceFiles,
  previousRendererPhase,
  rendererCaptureDescription,
  successfulRendererPhaseDirectories,
} from '../../scripts/renderer-capture/capture-contact-sheet';
import { rendererCaptureDigest } from '../../scripts/renderer-capture/lifecycle';
import {
  RENDERER_LOD_ACCEPTANCE_STATS_ASSERTION_IDS,
  RENDERER_LOD_ACCEPTANCE_VISUAL_CASES,
} from '../../src/perf/renderer-lod-acceptance';
import { LIGHT_LAYER_SPECS, SRC_HIT_FEATURES } from '../../src/map/layers';
import { bankedLayerId, bankedSourceId, type SourceBankId } from '../../src/map/source-bank';
import { isBankedRenderLayer } from '../../src/map/source-bank-layers';
import { COMMITTED_SYSTEM_FEATURE_SOURCES } from '../../src/map/system-feature-sources';
import type {
  RendererLodAcceptanceActionObservation,
  RendererLodAcceptanceBankIdentity,
  RendererLodAcceptanceManifest,
  RendererLodAcceptanceStatsSnapshot,
} from '../../scripts/renderer-capture/lod-acceptance-types';

const CURRENT_SOURCE = {
  revision: '0123456789abcdef0123456789abcdef01234567',
  dirty: true,
  contentSha256: 'a'.repeat(64),
} as const;
const LEGACY_SOURCE = {
  revision: '0123456789abcdef0123456789abcdef01234567',
  dirty: true,
} as const;

function acceptanceStats(
  overrides: Partial<RendererLodAcceptanceStatsSnapshot> = {},
): RendererLodAcceptanceStatsSnapshot {
  return {
    projectionCount: 10,
    fullUploadCount: 2,
    sourceUploadCount: 20,
    editorProjectionCount: 1,
    editorSourceUploadCount: 3,
    ...overrides,
  };
}

function acceptanceBankIdentity(
  bank: SourceBankId,
  activeRevision: string,
): RendererLodAcceptanceBankIdentity {
  const bankedSpecs = LIGHT_LAYER_SPECS.filter(isBankedRenderLayer);
  return {
    activeRevision,
    visibleLayerIds: bankedSpecs
      .filter((spec) => !('source' in spec) || spec.source !== SRC_HIT_FEATURES)
      .map((spec) => bankedLayerId(spec.id, bank)),
    visibleSourceIds: COMMITTED_SYSTEM_FEATURE_SOURCES.map((sourceId) =>
      bankedSourceId(sourceId, bank),
    ),
    hitSourceId: bankedSourceId(SRC_HIT_FEATURES, bank),
    hitLayerIds: bankedSpecs
      .filter((spec) => 'source' in spec && spec.source === SRC_HIT_FEATURES)
      .map((spec) => bankedLayerId(spec.id, bank)),
    featureStateSourceIds: [bankedSourceId(COMMITTED_SYSTEM_FEATURE_SOURCES[0], bank)],
  };
}

function acceptanceObservation(id: string): RendererLodAcceptanceActionObservation | undefined {
  if (id === 'hover-zero-committed-work') {
    return {
      kind: 'hover-feature-state',
      sourceId: bankedSourceId(COMMITTED_SYSTEM_FEATURE_SOURCES[0], 'a'),
      featureId: 'render:way:port-mason-harbor-bridge',
      hover: true,
    };
  }
  if (id === 'filter-zero-committed-work') {
    return {
      kind: 'way-type-filter',
      wayTypeId: 'road',
      beforeChecked: true,
      afterChecked: false,
      beforeFilterSha256: 'b'.repeat(64),
      afterFilterSha256: 'c'.repeat(64),
    };
  }
  if (id === 'retained-theme-zero-committed-work') {
    return { kind: 'map-scheme', before: 'light', after: 'dark', overlayHealthy: true };
  }
  return undefined;
}

function acceptanceManifest(): RendererLodAcceptanceManifest {
  const visuals = RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.map((entry) => ({
    ...entry,
    camera: { ...entry.camera, center: [...entry.camera.center] as [number, number] },
    fixture: { id: entry.fixtureId, documentId: `fixture-${entry.fixtureId}`, updatedAt: 0 },
    rendererStats: acceptanceStats(),
    sha256: rendererCaptureDigest(Buffer.from(entry.id)),
  }));
  const before = acceptanceStats();
  const assertions: RendererLodAcceptanceManifest['assertions'] =
    RENDERER_LOD_ACCEPTANCE_STATS_ASSERTION_IDS.map((id) => {
      const after =
        id === 'invalidating-camera-reprojects'
          ? acceptanceStats({ projectionCount: 11 })
          : id === 'selection-zero-committed-work'
            ? acceptanceStats({ editorProjectionCount: 2, editorSourceUploadCount: 4 })
            : acceptanceStats();
      const observation = acceptanceObservation(id);
      return {
        id,
        kind: 'renderer-stats',
        action: id,
        fixture: { id: 'port-mason', documentId: 'renderer-port-mason', updatedAt: 0 },
        camera: RENDERER_LOD_ACCEPTANCE_VISUAL_CASES[0].camera,
        before,
        after,
        delta: {
          projectionCount: after.projectionCount - before.projectionCount,
          fullUploadCount: after.fullUploadCount - before.fullUploadCount,
          sourceUploadCount: after.sourceUploadCount - before.sourceUploadCount,
          editorProjectionCount: after.editorProjectionCount - before.editorProjectionCount,
          editorSourceUploadCount: after.editorSourceUploadCount - before.editorSourceUploadCount,
        },
        ...(observation ? { observation } : {}),
        passed: true,
      };
    });
  assertions.push({
    id: 'bank-promotion-is-atomic',
    kind: 'bank-identity',
    action: 'promote a prepared revision',
    fixture: { id: 'port-mason', documentId: 'renderer-port-mason', updatedAt: 0 },
    camera: RENDERER_LOD_ACCEPTANCE_VISUAL_CASES[0].camera,
    before: acceptanceBankIdentity('a', 'old'),
    duringPreparation: acceptanceBankIdentity('a', 'old'),
    afterPromotion: acceptanceBankIdentity('b', 'new'),
    passed: true,
  });
  return {
    schemaVersion: 1,
    suiteId: 'phase-2-lod',
    phase: '01-lod',
    generatedAt: '2026-08-11T19:00:00.000Z',
    source: CURRENT_SOURCE,
    basemap: 'local-blank-v2',
    visuals,
    assertions,
  };
}

async function writeAcceptance(directory: string): Promise<void> {
  const manifest = acceptanceManifest();
  const acceptanceDirectory = join(directory, 'acceptance');
  await mkdir(join(acceptanceDirectory, 'images'), { recursive: true });
  await Promise.all(
    manifest.visuals.map((entry) =>
      writeFile(join(acceptanceDirectory, entry.file), Buffer.from(entry.id)),
    ),
  );
  await writeFile(join(acceptanceDirectory, 'manifest.json'), JSON.stringify(manifest));
}

describe('renderer contact sheets', () => {
  it('keeps the stable base regression corpus at exactly 116 captures', () => {
    expect(completeRendererEvidenceFiles('01-lod')).toHaveLength(116);
  });

  it('groups captures in deterministic baseline, previous, current, difference order', () => {
    const appendix = rendererLodAcceptanceContactSheetAppendix(acceptanceManifest());
    const html = rendererContactSheetHtml({
      phase: '02-geometry',
      captures: [
        {
          id: 'desktop-light-infrastructure-overview',
          description: 'Port Mason · z13.409 · 3 px target · 1440×900 @1x',
          comparisons: [
            { label: 'Baseline', path: 'baseline.png' },
            { label: 'Previous', path: 'previous.png' },
            { label: 'Current', path: 'current.png' },
            { label: 'Difference', path: 'difference.png' },
          ],
        },
      ],
      appendix,
    });

    expect(html.indexOf('Baseline')).toBeLessThan(html.indexOf('Previous'));
    expect(html.indexOf('Previous')).toBeLessThan(html.indexOf('Current'));
    expect(html.indexOf('Current')).toBeLessThan(html.indexOf('Difference'));
    expect(html).toContain('Renderer evidence: 02-geometry');
    expect(html).toContain('Port Mason · z13.409 · 3 px target · 1440×900 @1x');
    expect(html.indexOf('LOD acceptance')).toBeGreaterThan(
      html.indexOf('desktop-light-infrastructure-overview'),
    );
    expect(html).toContain('acceptance/manifest.json');
    expect(html).toContain('acceptance/images/selected-wide-corridor-10-5.png');
    expect(html).toContain('selected-wide-corridor-10-5');
    expect(html).toContain('hover-zero-committed-work');
    expect(html).toContain('Passed');
  });

  it('describes the exact fixture, camera, target width, and display density', () => {
    expect(
      rendererCaptureDescription({
        id: '01-lod-filmstrip-infrastructure-district-street-2',
        file: 'images/frame.png',
        profile: 'filmstrip',
        theme: 'light',
        viewMode: 'infrastructure',
        detail: 'filmstrip',
        zoom: 15.216254,
        targetCorridorWidthPx: 10.5,
        fixtureId: 'port-mason',
        viewport: { width: 1_440, height: 900, pixelRatio: 1 },
        camera: { center: [-122.446, 37.758], zoom: 15.216254 },
        rendererStats: null,
      }),
    ).toBe(
      'Port Mason reference · filmstrip/light/infrastructure/filmstrip · z15.216 · 10.5 px target · 1440×900 @1x',
    );
  });

  it('chooses history only from complete numbered phases with required provenance', async () => {
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
          source: phase === '00-baseline' ? LEGACY_SOURCE : CURRENT_SOURCE,
          basemap: phase === '00-baseline' ? 'local-blank-v1' : 'local-blank-v2',
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
    await writeAcceptance(join(root, '01-lod'));
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

  it('rejects current phases with legacy provenance or a missing LOD appendix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renderer-history-'));
    const current = join(root, '02-geometry');
    const phase = '01-lod';
    const directory = join(root, phase);
    const captures = completeRendererEvidenceFiles(phase);
    await mkdir(join(directory, 'images'), { recursive: true });
    await Promise.all(
      captures.map(({ id, file }) => writeFile(join(directory, file), Buffer.from(id))),
    );
    const manifest = {
      schemaVersion: 1,
      phase,
      complete: true,
      selection: { profile: 'all', theme: 'all' },
      source: LEGACY_SOURCE,
      basemap: 'local-blank-v1',
      captures: captures.map(({ id, file }) => ({
        id,
        file,
        sha256: rendererCaptureDigest(Buffer.from(id)),
      })),
    };
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));

    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([]);

    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({ ...manifest, source: CURRENT_SOURCE, basemap: 'local-blank-v2' }),
    );
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([]);

    await writeAcceptance(directory);
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual(['01-lod']);
  });

  it('requires current source and basemap provenance for every post-LOD phase', async () => {
    const root = await mkdtemp(join(tmpdir(), 'renderer-history-'));
    const phase = '02-geometry';
    const current = join(root, '03-junctions');
    const directory = join(root, phase);
    const captures = completeRendererEvidenceFiles(phase);
    await mkdir(join(directory, 'images'), { recursive: true });
    await Promise.all(
      captures.map(({ id, file }) => writeFile(join(directory, file), Buffer.from(id))),
    );
    const manifest = {
      schemaVersion: 1,
      phase,
      complete: true,
      selection: { profile: 'all', theme: 'all' },
      source: CURRENT_SOURCE,
      basemap: 'local-blank-v2',
      captures: captures.map(({ id, file }) => ({
        id,
        file,
        sha256: rendererCaptureDigest(Buffer.from(id)),
      })),
    };

    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({ ...manifest, source: { ...CURRENT_SOURCE, contentSha256: 'bad' } }),
    );
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([]);

    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({ ...manifest, basemap: 'local-blank-v1' }),
    );
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual([]);

    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await expect(successfulRendererPhaseDirectories(current)).resolves.toEqual(['02-geometry']);
  });

  it('uses the highest complete phase strictly before the current ordinal', () => {
    const phases = ['00-baseline', '01-lod', '02-physical-geometry', '04-network'];

    expect(previousRendererPhase('01-lod', phases)).toBe('00-baseline');
    expect(previousRendererPhase('03-junctions', phases)).toBe('02-physical-geometry');
    expect(previousRendererPhase('01-lod', [...phases, '06-final'])).toBe('00-baseline');
  });
});
