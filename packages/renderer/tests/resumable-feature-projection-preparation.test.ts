import { describe, expect, it } from 'vitest';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { aRoad, aSystem } from '@transitmapper/core/testing/fixtures';
import { SRC_WAYS } from '../src/layers/constants';
import { prepareResumableGeographicFeatureProjection } from '../src/resumable-feature-projection';

describe('resumable geographic feature projection preparation', () => {
  it('reports cold preparation separately when it exceeds the cooperative budget', () => {
    const timestamps = [10, 14.5];
    const prepared = prepareResumableGeographicFeatureProjection(
      {
        system: aSystem({
          ways: [
            aRoad('visible', [
              [-115.181, 36.14],
              [-115.179, 36.14],
            ]),
          ],
        }),
        selection: null,
        handleWayIds: [],
        view: {
          viewMode: 'infrastructure',
          visibleModes: new Set(['bus']),
          visibleWayTypes: new Set(['road']),
          presentation: renderPresentationForViewport({
            center: [-115.18, 36.14],
            zoom: 18,
            width: 1_440,
            height: 900,
          }),
        },
        sourceIds: [SRC_WAYS],
      },
      { budgetMs: 4, now: () => timestamps.shift() ?? 14.5 },
    );

    expect(prepared.plan.kind).toBe('ready');
    expect(prepared.stats).toEqual({
      preparationCount: 1,
      preparationDurationMs: 4.5,
      maxPreparationDurationMs: 4.5,
      overBudgetPreparationCount: 1,
    });
  });

  it('rejects an invalid preparation budget before planning', () => {
    expect(() =>
      prepareResumableGeographicFeatureProjection(
        {
          system: aSystem(),
          selection: null,
          handleWayIds: [],
          view: {
            viewMode: 'infrastructure',
            visibleModes: new Set(),
            visibleWayTypes: new Set(),
            presentation: renderPresentationForViewport({
              center: [0, 0],
              zoom: 1,
              width: 100,
              height: 100,
            }),
          },
          sourceIds: [SRC_WAYS],
        },
        { budgetMs: 0, now: () => 0 },
      ),
    ).toThrow('finite positive');
  });
});
