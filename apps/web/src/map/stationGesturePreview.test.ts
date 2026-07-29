import { describe, expect, it } from 'vitest';
import type { Feature, Point } from 'geojson';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { GestureProjection } from './gestureProjection';
import {
  combineGestureSettlementPreview,
  createStationGesturePreviewController,
  createStationSettlementPreviewFeatures,
} from './stationGesturePreview';

function stationFeature(id: string, coordinates: [number, number]): Feature<Point> {
  return {
    type: 'Feature',
    properties: { id, name: id },
    geometry: { type: 'Point', coordinates },
  };
}

function stationProjection(id: string, coordinates: [number, number]): GestureProjection {
  return {
    data: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id, kind: 'station', ownerId: id },
          geometry: { type: 'Point', coordinates },
        },
      ],
    },
    affected: {
      wayIds: [],
      stationIds: [id],
      facilityIds: [],
      groupIds: [],
      nodeIds: [],
    },
  };
}

describe('station settlement preview composition', () => {
  it('keeps station A visible and masked while station B becomes active', () => {
    const settling = createStationSettlementPreviewFeatures([stationFeature('station-a', [1, 1])]);
    const combined = combineGestureSettlementPreview(
      stationProjection('station-b', [2, 2]),
      ['station-a'],
      settling,
    );

    expect(combined?.affected.stationIds).toEqual(['station-a', 'station-b']);
    expect(
      combined?.data.features.map((feature) => [
        feature.properties?.id,
        feature.geometry.type === 'Point' ? feature.geometry.coordinates : null,
      ]),
    ).toEqual([
      ['station-a', [1, 1]],
      ['station-b', [2, 2]],
    ]);
  });

  it('lets an active repeat drag replace its older settling point', () => {
    const settling = createStationSettlementPreviewFeatures([stationFeature('station-a', [1, 1])]);
    const combined = combineGestureSettlementPreview(
      stationProjection('station-a', [3, 3]),
      ['station-a'],
      settling,
    );

    expect(combined?.data.features).toHaveLength(1);
    expect(combined?.data.features[0]?.geometry).toEqual({
      type: 'Point',
      coordinates: [3, 3],
    });
  });

  it('retains a mask owner when a pending station has been deleted', () => {
    const combined = combineGestureSettlementPreview(null, ['station-a'], []);

    expect(combined?.data.features).toEqual([]);
    expect(combined?.affected.stationIds).toEqual(['station-a']);
  });

  it('keeps retained stations truthful while another station gesture is active', () => {
    const renders: Array<GestureProjection | null> = [];
    const preview = createStationGesturePreviewController({
      render(projection) {
        renders.push(projection);
        return true;
      },
    });

    preview.showActive(stationProjection('station-a', [1, 1]));
    preview.retainActiveStations(['station-a']);
    preview.showActive(stationProjection('station-b', [2, 2]));
    preview.syncStations({
      ...createEmptySystem(),
      stations: [{ id: 'station-a', coord: [3, 3], anchors: [] }],
    });

    expect(
      renders
        .at(-1)
        ?.data.features.map((feature) => [
          feature.properties?.id,
          feature.geometry.type === 'Point' ? feature.geometry.coordinates : null,
        ]),
    ).toEqual([
      ['station-a', [3, 3]],
      ['station-b', [2, 2]],
    ]);

    preview.releaseStations();
    expect(renders.at(-1)).toEqual(stationProjection('station-b', [2, 2]));
  });
});
