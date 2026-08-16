import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RendererLodAcceptanceManifest } from '../../scripts/renderer-capture/lod-acceptance-types';
import {
  loadValidRendererLodAcceptanceManifest,
  validateRendererLodAcceptanceManifest,
} from '../../scripts/renderer-capture/lod-acceptance-validation';
import {
  RENDERER_LOD_ACCEPTANCE_SOURCE as SOURCE,
  validRendererLodAcceptanceManifest,
  writeRendererLodAcceptanceManifest,
} from '../support/renderer-lod-acceptance.test';

async function preparedManifest() {
  const directory = await mkdtemp(join(tmpdir(), 'renderer-lod-acceptance-'));
  const manifest = validRendererLodAcceptanceManifest();
  await writeRendererLodAcceptanceManifest(directory, manifest);
  return { directory, manifest };
}

describe('renderer LOD acceptance manifest validation', () => {
  it('accepts only the exact hashed visual and machine-assertion corpus', async () => {
    const { directory, manifest } = await preparedManifest();

    await expect(
      validateRendererLodAcceptanceManifest(manifest, directory, SOURCE),
    ).resolves.toEqual([]);
    await expect(loadValidRendererLodAcceptanceManifest(directory, SOURCE)).resolves.toEqual(
      manifest,
    );
  });

  it('rejects missing, extra, and duplicate visual IDs', async () => {
    const { directory, manifest } = await preparedManifest();

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
    const { directory, manifest } = await preparedManifest();

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
    const { directory, manifest } = await preparedManifest();
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
    const { directory, manifest } = await preparedManifest();

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
        entry.id === 'filter-zero-committed-work'
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
        entry.id === 'retained-theme-zero-committed-work'
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
});
