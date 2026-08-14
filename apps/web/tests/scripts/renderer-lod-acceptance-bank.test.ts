import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRendererLodAcceptanceManifest } from '../../scripts/renderer-capture/lod-acceptance-validation';
import {
  RENDERER_LOD_ACCEPTANCE_SOURCE as SOURCE,
  rendererLodAcceptanceBankIdentity,
  validRendererLodAcceptanceManifest,
  writeRendererLodAcceptanceManifest,
} from '../support/renderer-lod-acceptance.test';

describe('renderer LOD acceptance bank validation', () => {
  it('rejects mixed bank identity and mismatched source provenance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'renderer-lod-acceptance-'));
    const manifest = validRendererLodAcceptanceManifest();
    await writeRendererLodAcceptanceManifest(directory, manifest);

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
                ...rendererLodAcceptanceBankIdentity('a', 'revision-new'),
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
