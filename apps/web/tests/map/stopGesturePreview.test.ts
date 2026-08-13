import { describe, expect, it } from 'vitest';
import type { Feature, Point } from 'geojson';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { GestureProjection } from '../../src/map/gestureProjection';
import {
  combineGestureSettlementPreview,
  createStopGesturePreviewController,
  createStopSettlementPreviewFeatures,
} from '../../src/map/stopGesturePreview';

function stopFeature(id: string, coordinates: [number, number]): Feature<Point> {
  return {
    type: 'Feature',
    properties: { id, name: id },
    geometry: { type: 'Point', coordinates },
  };
}

function stopProjection(id: string, coordinates: [number, number]): GestureProjection {
  return {
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id, kind: 'stop', ownerId: id },
          geometry: { type: 'Point', coordinates },
        },
      ],
    },
    affected: {
      wayIds: [],
      stopIds: [id],
      stationIds: [],
      facilityIds: [],
      groupIds: [],
      nodeIds: [],
    },
  };
}

describe('stop settlement preview composition', () => {
  it('keeps stop A visible and masked while stop B becomes active', () => {
    const settling = createStopSettlementPreviewFeatures([stopFeature('stop-a', [1, 1])]);
    const combined = combineGestureSettlementPreview(
      stopProjection('stop-b', [2, 2]),
      ['stop-a'],
      settling,
    );

    expect(combined?.affected.stopIds).toEqual(['stop-a', 'stop-b']);
    expect(
      combined?.data.features.map((feature) => {
        const id: unknown = feature.properties?.id;
        return [id, feature.geometry.type === 'Point' ? feature.geometry.coordinates : null];
      }),
    ).toEqual([
      ['stop-a', [1, 1]],
      ['stop-b', [2, 2]],
    ]);
  });

  it('lets an active repeat drag replace its older settling point', () => {
    const settling = createStopSettlementPreviewFeatures([stopFeature('stop-a', [1, 1])]);
    const combined = combineGestureSettlementPreview(
      stopProjection('stop-a', [3, 3]),
      ['stop-a'],
      settling,
    );

    expect(combined?.data.features).toHaveLength(1);
    expect(combined?.data.features[0]?.geometry).toEqual({
      type: 'Point',
      coordinates: [3, 3],
    });
  });

  it('retains a mask owner when a pending stop has been deleted', () => {
    const combined = combineGestureSettlementPreview(null, ['stop-a'], []);

    expect(combined?.data.features).toEqual([]);
    expect(combined?.affected.stopIds).toEqual(['stop-a']);
  });

  it('keeps retained stops truthful while another stop gesture is active', () => {
    const renders: Array<GestureProjection | null> = [];
    const preview = createStopGesturePreviewController({
      render(projection) {
        renders.push(projection);
        return true;
      },
    });

    preview.showActive(stopProjection('stop-a', [1, 1]));
    preview.retainActiveStops(['stop-a']);
    preview.showActive(stopProjection('stop-b', [2, 2]));
    preview.syncStops({
      ...createEmptySystem(),
      stops: [{ id: 'stop-a', coord: [3, 3], anchors: [] }],
    });

    expect(
      renders.at(-1)?.data.features.map((feature) => {
        const id: unknown = feature.properties?.id;
        return [id, feature.geometry.type === 'Point' ? feature.geometry.coordinates : null];
      }),
    ).toEqual([
      ['stop-a', [3, 3]],
      ['stop-b', [2, 2]],
    ]);

    preview.releaseStops();
    expect(renders.at(-1)).toEqual(stopProjection('stop-b', [2, 2]));
  });

  it('replays a retained stop after its map style is replaced', () => {
    const renders: Array<GestureProjection | null> = [];
    const preview = createStopGesturePreviewController({
      render(projection) {
        renders.push(projection);
        return true;
      },
    });

    preview.retainCommitted(['stop-a'], [stopFeature('stop-a', [1, 1])]);
    const retainedProjection = renders.at(-1);

    expect(preview.refresh()).toBe(true);
    expect(renders).toEqual([retainedProjection, retainedProjection]);
    expect(renders.at(-1)?.affected.stopIds).toEqual(['stop-a']);
    expect(renders.at(-1)?.data.features[0]?.geometry).toEqual({
      type: 'Point',
      coordinates: [1, 1],
    });
  });
});
