import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RENDERER_LOD_ACCEPTANCE_STATS_ASSERTION_IDS,
  RENDERER_LOD_ACCEPTANCE_VISUAL_CASES,
} from '../../src/perf/renderer-lod-acceptance';
import { isBankedRenderLayer } from '../../src/map/source-bank-layers';
import { SRC_HIT_FEATURES } from '../../src/map/layers';
import { LIGHT_LAYER_SPECS } from '../../src/map/layers/layerSpecs';
import { COMMITTED_SYSTEM_FEATURE_SOURCES } from '../../src/map/system-feature-sources';
import type {
  RendererLodAcceptanceManifest,
  RendererLodAcceptanceStatsSnapshot,
} from '../../scripts/renderer-capture/lod-acceptance-types';
import {
  loadValidRendererLodAcceptanceManifest,
  validateRendererLodAcceptanceManifest,
} from '../../scripts/renderer-capture/lod-acceptance-validation';
import { rendererCaptureDigest } from '../../scripts/renderer-capture/lifecycle';

const SOURCE = {
  revision: '0123456789abcdef0123456789abcdef01234567',
  dirty: true,
  contentSha256: 'a'.repeat(64),
} as const;

function stats(overrides: Partial<RendererLodAcceptanceStatsSnapshot> = {}) {
  return {
    projectionCount: 10,
    fullUploadCount: 2,
    sourceUploadCount: 20,
    editorProjectionCount: 1,
    editorSourceUploadCount: 3,
    ...overrides,
  };
}

function statAssertion(
  id: (typeof RENDERER_LOD_ACCEPTANCE_STATS_ASSERTION_IDS)[number],
  invalidating = false,
) {
  const before = stats();
  const after = invalidating
    ? stats({ projectionCount: 11 })
    : id === 'selection-zero-committed-work'
      ? stats({ editorProjectionCount: 2, editorSourceUploadCount: 5 })
      : stats();
  return {
    id,
    kind: 'renderer-stats' as const,
    action: id,
    fixture: { id: 'port-mason' as const, documentId: 'renderer-port-mason', updatedAt: 0 },
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
    ...(id === 'hover-zero-committed-work'
      ? {
          observation: {
            kind: 'hover-feature-state' as const,
            sourceId: 'tm-ways--bank-a',
            featureId: 'way:port-mason-harbor-bridge',
            hover: true as const,
          },
        }
      : id === 'filter-zero-committed-work'
        ? {
            observation: {
              kind: 'way-type-filter' as const,
              wayTypeId: 'road' as const,
              beforeChecked: true as const,
              afterChecked: false as const,
              beforeFilterSha256: 'b'.repeat(64),
              afterFilterSha256: 'c'.repeat(64),
            },
          }
        : id === 'retained-theme-zero-committed-work'
          ? {
              observation: {
                kind: 'map-scheme' as const,
                before: 'light' as const,
                after: 'dark' as const,
                overlayHealthy: true as const,
              },
            }
          : {}),
    passed: true,
  };
}

function layerSource(spec: (typeof LIGHT_LAYER_SPECS)[number]): string | null {
  return 'source' in spec && typeof spec.source === 'string' ? spec.source : null;
}

const BANKED_LAYER_SPECS = LIGHT_LAYER_SPECS.filter(isBankedRenderLayer);
const VISUAL_LAYER_IDS = BANKED_LAYER_SPECS.filter(
  (spec) => layerSource(spec) !== SRC_HIT_FEATURES,
).map((spec) => spec.id);
const HIT_LAYER_IDS = BANKED_LAYER_SPECS.filter(
  (spec) => layerSource(spec) === SRC_HIT_FEATURES,
).map((spec) => spec.id);

function bankIdentity(bank: 'a' | 'b', revision: string) {
  const physical = (id: string) => `${id}--bank-${bank}`;
  return {
    activeRevision: revision,
    visibleLayerIds: VISUAL_LAYER_IDS.map(physical),
    visibleSourceIds: COMMITTED_SYSTEM_FEATURE_SOURCES.map(physical),
    hitSourceId: physical(SRC_HIT_FEATURES),
    hitLayerIds: HIT_LAYER_IDS.map(physical),
    featureStateSourceIds: [physical('tm-ways')],
  };
}

function validManifest(): RendererLodAcceptanceManifest {
  const visuals = RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.map((entry) => ({
    ...entry,
    camera: { ...entry.camera, center: [...entry.camera.center] as [number, number] },
    fixture: { id: entry.fixtureId, documentId: `fixture-${entry.fixtureId}`, updatedAt: 0 },
    rendererStats: stats(),
    sha256: rendererCaptureDigest(Buffer.from(entry.id)),
  }));
  const statsAssertions = RENDERER_LOD_ACCEPTANCE_STATS_ASSERTION_IDS.map((id) =>
    statAssertion(id, id === 'invalidating-camera-reprojects'),
  );
  return {
    schemaVersion: 1,
    suiteId: 'phase-2-lod',
    phase: '01-lod',
    generatedAt: '2026-08-11T19:00:00.000Z',
    source: SOURCE,
    basemap: 'local-blank-v2',
    visuals,
    assertions: [
      ...statsAssertions,
      {
        id: 'bank-promotion-is-atomic',
        kind: 'bank-identity',
        action: 'promote a prepared revision',
        fixture: { id: 'port-mason', documentId: 'renderer-port-mason', updatedAt: 0 },
        camera: RENDERER_LOD_ACCEPTANCE_VISUAL_CASES[0].camera,
        before: bankIdentity('a', 'revision-old'),
        duringPreparation: bankIdentity('a', 'revision-old'),
        afterPromotion: bankIdentity('b', 'revision-new'),
        passed: true,
      },
    ],
  };
}

async function writeManifest(directory: string, manifest: RendererLodAcceptanceManifest) {
  await mkdir(join(directory, 'images'), { recursive: true });
  await Promise.all(
    manifest.visuals.map((entry) => writeFile(join(directory, entry.file), entry.id)),
  );
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
}

describe('renderer LOD acceptance manifest validation', () => {
  it('accepts only the exact hashed visual and machine-assertion corpus', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'renderer-lod-acceptance-'));
    const manifest = validManifest();
    await writeManifest(directory, manifest);

    await expect(
      validateRendererLodAcceptanceManifest(manifest, directory, SOURCE),
    ).resolves.toEqual([]);
    await expect(loadValidRendererLodAcceptanceManifest(directory, SOURCE)).resolves.toEqual(
      manifest,
    );
  });

  it('rejects missing, extra, and duplicate visual IDs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'renderer-lod-acceptance-'));
    const manifest = validManifest();
    await writeManifest(directory, manifest);

    const missing = { ...manifest, visuals: manifest.visuals.slice(1) };
    expect(await validateRendererLodAcceptanceManifest(missing, directory, SOURCE)).toContain(
      'Acceptance visuals must contain the exact 21-case ID set.',
    );

    const extra = {
      ...manifest,
      visuals: [...manifest.visuals, { ...manifest.visuals[0], id: 'extra' }],
    };
    expect(await validateRendererLodAcceptanceManifest(extra, directory, SOURCE)).toContain(
      'Acceptance visuals must contain the exact 21-case ID set.',
    );

    const duplicate = {
      ...manifest,
      visuals: manifest.visuals.map((entry, index) =>
        index === 1 ? { ...entry, id: manifest.visuals[0].id } : entry,
      ),
    };
    expect(await validateRendererLodAcceptanceManifest(duplicate, directory, SOURCE)).toContain(
      'Acceptance visuals must contain the exact 21-case ID set.',
    );
  });

  it('rejects path escapes, undeclared aliases, and mismatched file hashes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'renderer-lod-acceptance-'));
    const manifest = validManifest();
    await writeManifest(directory, manifest);

    const escaping = {
      ...manifest,
      visuals: manifest.visuals.map((entry, index) =>
        index === 0 ? { ...entry, file: '../escaped.png' as `images/${string}.png` } : entry,
      ),
    };
    expect(await validateRendererLodAcceptanceManifest(escaping, directory, SOURCE)).toContain(
      'Acceptance visual selected-wide-corridor-10-5 must use its declared images path.',
    );

    const aliased = {
      ...manifest,
      visuals: manifest.visuals.map((entry, index) =>
        index === 1 ? { ...entry, file: manifest.visuals[0].file } : entry,
      ),
    };
    expect(await validateRendererLodAcceptanceManifest(aliased, directory, SOURCE)).toContain(
      'Acceptance visual tunnel-below-12 must use its declared images path.',
    );

    const badHash = {
      ...manifest,
      visuals: manifest.visuals.map((entry, index) =>
        index === 0 ? { ...entry, sha256: '0'.repeat(64) } : entry,
      ),
    };
    expect(await validateRendererLodAcceptanceManifest(badHash, directory, SOURCE)).toContain(
      'Acceptance visual selected-wide-corridor-10-5 hash does not match its file.',
    );
  });

  it('accepts only a bounded real camera sample for the in-motion pan frame', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'renderer-lod-acceptance-'));
    const manifest = validManifest();
    await writeManifest(directory, manifest);
    const moving = {
      ...manifest,
      visuals: manifest.visuals.map((entry) =>
        entry.id === 'fast-pan-edge-preload'
          ? {
              ...entry,
              camera: {
                ...entry.camera,
                center: [entry.camera.center[0] + 0.001, entry.camera.center[1]] as [
                  number,
                  number,
                ],
              },
            }
          : entry,
      ),
    };
    await expect(validateRendererLodAcceptanceManifest(moving, directory, SOURCE)).resolves.toEqual(
      [],
    );

    const escapedMotion = {
      ...moving,
      visuals: moving.visuals.map((entry) =>
        entry.id === 'fast-pan-edge-preload'
          ? {
              ...entry,
              camera: {
                ...entry.camera,
                center: [entry.camera.center[0] + 1, entry.camera.center[1]] as [number, number],
              },
            }
          : entry,
      ),
    };
    expect(await validateRendererLodAcceptanceManifest(escapedMotion, directory, SOURCE)).toContain(
      'Acceptance visual fast-pan-edge-preload has invalid capture provenance.',
    );
  });

  it('rejects failed or fabricated machine assertions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'renderer-lod-acceptance-'));
    const manifest = validManifest();
    await writeManifest(directory, manifest);

    const failed = {
      ...manifest,
      assertions: manifest.assertions.map((entry, index) =>
        index === 0 ? { ...entry, passed: false } : entry,
      ),
    } as RendererLodAcceptanceManifest;
    expect(await validateRendererLodAcceptanceManifest(failed, directory, SOURCE)).toContain(
      'Acceptance assertion hover-zero-committed-work did not pass.',
    );

    const fabricatedDelta = {
      ...manifest,
      assertions: manifest.assertions.map((entry, index) =>
        index === 0 && entry.kind === 'renderer-stats'
          ? { ...entry, delta: { ...entry.delta, projectionCount: 4 } }
          : entry,
      ),
    } as RendererLodAcceptanceManifest;
    expect(
      await validateRendererLodAcceptanceManifest(fabricatedDelta, directory, SOURCE),
    ).toContain('Acceptance assertion hover-zero-committed-work has a fabricated stats delta.');

    const missingActionObservation = {
      ...manifest,
      assertions: manifest.assertions.map((entry) =>
        entry.id === 'hover-zero-committed-work' ? { ...entry, observation: undefined } : entry,
      ),
    } as RendererLodAcceptanceManifest;
    expect(
      await validateRendererLodAcceptanceManifest(missingActionObservation, directory, SOURCE),
    ).toContain('Acceptance hover assertion does not prove applied feature state.');

    const unchangedFilter = {
      ...manifest,
      assertions: manifest.assertions.map((entry) =>
        entry.id === 'filter-zero-committed-work' && entry.kind === 'renderer-stats'
          ? {
              ...entry,
              observation: {
                kind: 'way-type-filter' as const,
                wayTypeId: 'road' as const,
                beforeChecked: true as const,
                afterChecked: false as const,
                beforeFilterSha256: 'b'.repeat(64),
                afterFilterSha256: 'b'.repeat(64),
              },
            }
          : entry,
      ),
    } as RendererLodAcceptanceManifest;
    expect(
      await validateRendererLodAcceptanceManifest(unchangedFilter, directory, SOURCE),
    ).toContain('Acceptance filter assertion does not prove an applied same-view filter change.');

    const unappliedTheme = {
      ...manifest,
      assertions: manifest.assertions.map((entry) =>
        entry.id === 'retained-theme-zero-committed-work' && entry.kind === 'renderer-stats'
          ? {
              ...entry,
              observation: {
                kind: 'map-scheme' as const,
                before: 'light' as const,
                after: 'light' as 'dark',
                overlayHealthy: true as const,
              },
            }
          : entry,
      ),
    } as RendererLodAcceptanceManifest;
    expect(
      await validateRendererLodAcceptanceManifest(unappliedTheme, directory, SOURCE),
    ).toContain('Acceptance theme assertion does not prove an applied healthy dark map.');
  });

  it('rejects mixed bank identity and mismatched source provenance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'renderer-lod-acceptance-'));
    const manifest = validManifest();
    await writeManifest(directory, manifest);

    const mixedBank = {
      ...manifest,
      assertions: manifest.assertions.map((entry) =>
        entry.kind === 'bank-identity'
          ? {
              ...entry,
              duringPreparation: {
                ...entry.duringPreparation,
                hitSourceId: 'hit-features--bank-b',
              },
            }
          : entry,
      ),
    };
    expect(await validateRendererLodAcceptanceManifest(mixedBank, directory, SOURCE)).toContain(
      'Acceptance bank assertion observed mixed visible and interaction identity.',
    );

    const changedDuringPreparation = {
      ...manifest,
      assertions: manifest.assertions.map((entry) =>
        entry.kind === 'bank-identity'
          ? {
              ...entry,
              duringPreparation: {
                ...entry.duringPreparation,
                visibleLayerIds: ['different-layer--bank-a'],
              },
            }
          : entry,
      ),
    };
    expect(
      await validateRendererLodAcceptanceManifest(changedDuringPreparation, directory, SOURCE),
    ).toContain('Acceptance bank assertion changed active IDs during hidden preparation.');

    const sameBankRevisionOnly = {
      ...manifest,
      assertions: manifest.assertions.map((entry) =>
        entry.kind === 'bank-identity'
          ? {
              ...entry,
              afterPromotion: {
                ...entry.afterPromotion,
                ...bankIdentity('a', 'revision-new'),
              },
            }
          : entry,
      ),
    };
    expect(
      await validateRendererLodAcceptanceManifest(sameBankRevisionOnly, directory, SOURCE),
    ).toContain('Acceptance bank assertion did not promote to a new bank and revision.');

    const swappedLogicalSource = {
      ...manifest,
      assertions: manifest.assertions.map((entry) =>
        entry.kind === 'bank-identity'
          ? {
              ...entry,
              afterPromotion: {
                ...entry.afterPromotion,
                visibleSourceIds: ['unrelated-source--bank-b'],
              },
            }
          : entry,
      ),
    };
    expect(
      await validateRendererLodAcceptanceManifest(swappedLogicalSource, directory, SOURCE),
    ).toContain('Acceptance bank assertion changed logical IDs during promotion.');

    const missingVisibleSource = {
      ...manifest,
      assertions: manifest.assertions.map((entry) =>
        entry.kind === 'bank-identity'
          ? {
              ...entry,
              before: {
                ...entry.before,
                visibleSourceIds: entry.before.visibleSourceIds.slice(1),
              },
            }
          : entry,
      ),
    };
    expect(
      await validateRendererLodAcceptanceManifest(missingVisibleSource, directory, SOURCE),
    ).toContain('Acceptance bank assertion does not contain the exact committed identity sets.');

    const extraVisibleLayer = {
      ...manifest,
      assertions: manifest.assertions.map((entry) =>
        entry.kind === 'bank-identity'
          ? {
              ...entry,
              afterPromotion: {
                ...entry.afterPromotion,
                visibleLayerIds: [...entry.afterPromotion.visibleLayerIds, 'tm-unrelated--bank-b'],
              },
            }
          : entry,
      ),
    };
    expect(
      await validateRendererLodAcceptanceManifest(extraVisibleLayer, directory, SOURCE),
    ).toContain('Acceptance bank assertion does not contain the exact committed identity sets.');

    expect(
      await validateRendererLodAcceptanceManifest(manifest, directory, {
        ...SOURCE,
        contentSha256: 'b'.repeat(64),
      }),
    ).toContain('Acceptance source provenance must match the parent renderer manifest.');
  });
});
