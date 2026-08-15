import type { Page } from 'playwright-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  rendererLodAcceptanceBankIdentity,
  rendererLodAcceptanceStatsAssertion,
  rendererLodAcceptanceStatsSnapshot,
  requiredRendererBankAcceptanceSnapshot,
} from '../../scripts/renderer-capture/lod-acceptance-runner';
import { selectAcceptanceWay } from '../../scripts/renderer-capture/lod-acceptance-visual-capture';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('renderer LOD acceptance runner', () => {
  it('separates committed bank uploads from editor-owned and transient sources', () => {
    expect(
      rendererLodAcceptanceStatsSnapshot(
        {
          projectionCount: 7,
          fullUploadCount: 2,
          editorProjectionCount: 3,
        },
        [
          { sourceId: 'tm-ways--bank-a', method: 'updateData', callCount: 2 },
          { sourceId: 'tm-hit-features--bank-b', method: 'setData', callCount: 1 },
          { sourceId: 'tm-handles', method: 'updateData', callCount: 4 },
          { sourceId: 'tm-physical-handles', method: 'setData', callCount: 2 },
          { sourceId: 'vehicles', method: 'setData', callCount: 9 },
        ],
      ),
    ).toEqual({
      projectionCount: 7,
      fullUploadCount: 2,
      sourceUploadCount: 3,
      editorProjectionCount: 3,
      editorSourceUploadCount: 6,
    });
  });

  it('requires and normalizes the production bank snapshot without a paused transaction seam', () => {
    expect(() => requiredRendererBankAcceptanceSnapshot({})).toThrow(
      'Phase 2 bank acceptance requires __perfRenderSourceBankSnapshot.',
    );

    const snapshot = () => ({
      activeBank: 'a' as const,
      stagingBank: null,
      activeRevision: 'revision',
      activeVisualSourceIds: ['tm-ways--bank-a'],
      activeVisualLayerIds: ['tm-ways-solid--bank-a'],
      activeVisualSourceId: 'tm-ways--bank-a',
      activeHitSourceId: 'tm-hit-features--bank-a',
      activeHitLayerIds: ['tm-services-hit--bank-a'],
      activeVisualLayerId: 'tm-ways-solid--bank-a',
      activeHitLayerId: 'tm-services-hit--bank-a',
      selectedFeatureStateSourceIds: ['tm-ways--bank-a'],
      diagnostics: {},
    });
    expect(
      requiredRendererBankAcceptanceSnapshot({ __perfRenderSourceBankSnapshot: snapshot }),
    ).toBe(snapshot);
    expect(rendererLodAcceptanceBankIdentity(snapshot())).toEqual({
      activeRevision: 'revision',
      visibleLayerIds: ['tm-ways-solid--bank-a'],
      visibleSourceIds: ['tm-ways--bank-a'],
      hitSourceId: 'tm-hit-features--bank-a',
      hitLayerIds: ['tm-services-hit--bank-a'],
      featureStateSourceIds: ['tm-ways--bank-a'],
    });
  });

  it('derives assertion deltas from before and after snapshots', () => {
    const before = {
      projectionCount: 4,
      fullUploadCount: 1,
      sourceUploadCount: 8,
      editorProjectionCount: 2,
      editorSourceUploadCount: 3,
    };
    const fixture = { id: 'port-mason' as const, documentId: 'renderer-port-mason', updatedAt: 0 };
    const camera = {
      center: [-122.446, 37.758] as [number, number],
      zoom: 14,
      viewport: { width: 960, height: 600, pixelRatio: 1 },
    };

    expect(
      rendererLodAcceptanceStatsAssertion({
        id: 'selection-zero-committed-work',
        action: 'select a way',
        fixture,
        camera,
        before,
        after: { ...before, editorProjectionCount: 3, editorSourceUploadCount: 5 },
        observation: {
          kind: 'hover-feature-state',
          sourceId: 'tm-ways--bank-a',
          featureId: 'way:1',
          hover: true,
        },
      }),
    ).toMatchObject({
      passed: true,
      delta: {
        projectionCount: 0,
        fullUploadCount: 0,
        sourceUploadCount: 0,
        editorProjectionCount: 1,
        editorSourceUploadCount: 2,
      },
      observation: {
        kind: 'hover-feature-state',
        sourceId: 'tm-ways--bank-a',
        featureId: 'way:1',
        hover: true,
      },
    });

    expect(
      rendererLodAcceptanceStatsAssertion({
        id: 'invalidating-camera-reprojects',
        action: 'leave accepted coverage',
        fixture,
        camera,
        before,
        after: { ...before, projectionCount: 5 },
      }).passed,
    ).toBe(true);
  });

  it('selects an acceptance corridor through the editor command boundary', async () => {
    const select = vi.fn();
    const settled = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      __editor: {
        getState: () => ({}),
        commands: { selection: { select } },
      },
      __rendererCaptureWhenSettled: settled,
    });
    const page = {
      evaluate: <Argument>(callback: (argument: Argument) => unknown, argument: Argument) =>
        Promise.resolve(callback(argument)),
    } as unknown as Page;

    await selectAcceptanceWay(page, 'port-mason-harbor-bridge');

    expect(select).toHaveBeenCalledWith({ kind: 'way', id: 'port-mason-harbor-bridge' });
    expect(settled).toHaveBeenCalledOnce();
  });
});
