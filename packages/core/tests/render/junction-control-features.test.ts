import type { Feature } from 'geojson';
import { describe, expect, it } from 'vitest';
import { MODE_ORDER, WAY_TYPE_ORDER } from '../../src/model/catalog';
import { profileWidthM } from '../../src/model/profile';
import { parseSystem } from '../../src/model/serialize';
import type { LngLat, Way } from '../../src/model/system';
import { buildFeatures, type RenderViewOptions } from '../../src/render/buildFeatures';
import { widthPxAtZ14 } from '../../src/render/constants';
import { resolveStaticVisualScene } from '../../src/render/static-visual-scene';
import { aRoad, aSystem } from '../support/fixtures.test';

const BOUNDS = {
  southwest: [-115.3, 36] as LngLat,
  northeast: [-115, 36.3] as LngLat,
};

function streetView(way: Way): RenderViewOptions {
  const widthAtZ14 = widthPxAtZ14(profileWidthM(way.profile), way.points[0]?.[1] ?? 0);
  return {
    viewMode: 'infrastructure',
    visibleModes: new Set(MODE_ORDER),
    visibleWayTypes: new Set(WAY_TYPE_ORDER),
    presentation: {
      bounds: BOUNDS,
      zoom: 14 + Math.log2(16 / widthAtZ14),
      viewportWidthPx: 1_440,
      viewportHeightPx: 900,
      displayedWidthPx: 1_440,
      displayedHeightPx: 900,
      pixelRatio: 1,
    },
  };
}

function property(feature: Feature | undefined, name: string): unknown {
  return feature?.properties?.[name];
}

describe('junction control features', () => {
  it('emits a Street-tier signal marker from an authored junction control', () => {
    const nodeCoord: LngLat = [-115.16, 36.14];
    const west = aRoad('west', [[-115.2, 36.14], nodeCoord]);
    const east = aRoad('east', [nodeCoord, [-115.12, 36.14]]);
    const south = aRoad('south', [[-115.16, 36.1], nodeCoord]);
    const north = aRoad('north', [nodeCoord, [-115.16, 36.18]]);
    const features = buildFeatures(
      aSystem({
        ways: [west, east, south, north],
        nodes: [
          {
            id: 'junction',
            coord: nodeCoord,
            control: 'signal',
            refs: [
              { wayId: west.id, pointIndex: 1 },
              { wayId: east.id, pointIndex: 0 },
              { wayId: south.id, pointIndex: 1 },
              { wayId: north.id, pointIndex: 0 },
            ],
          },
        ],
      }),
      null,
      [],
      streetView(west),
    );

    const signal = features.junctions.features.find(
      (feature) => property(feature, 'control') === 'signal',
    );

    expect(signal?.geometry).toEqual({ type: 'Point', coordinates: nodeCoord });
    expect(property(signal, 'nodeId')).toBe('junction');
    expect(property(signal, 'renderTier')).toBe('street');

    const crosswalk = features.laneMarkings.features.find(
      (feature) =>
        property(feature, 'kind') === 'crosswalk' && property(feature, 'wayId') === 'west',
    );
    expect(crosswalk?.geometry.type).toBe('MultiLineString');
    expect(property(crosswalk, 'nodeId')).toBe('junction');
    expect(property(crosswalk, 'wayId')).toBe('west');

    const stopBar = features.laneMarkings.features.find(
      (feature) => property(feature, 'kind') === 'stopBar' && property(feature, 'wayId') === 'west',
    );
    expect(stopBar?.geometry.type).toBe('LineString');
    expect(property(stopBar, 'nodeId')).toBe('junction');
  });

  it('renders an authored approach control only on its affected arm', () => {
    const nodeCoord: LngLat = [-115.16, 36.14];
    const west = aRoad('west', [[-115.2, 36.14], nodeCoord]);
    const east = aRoad('east', [nodeCoord, [-115.12, 36.14]]);
    const south = aRoad('south', [[-115.16, 36.1], nodeCoord]);
    const north = aRoad('north', [nodeCoord, [-115.16, 36.18]]);
    const features = buildFeatures(
      aSystem({
        ways: [west, east, south, north],
        nodes: [
          {
            id: 'junction',
            coord: nodeCoord,
            refs: [
              { wayId: west.id, pointIndex: 1 },
              { wayId: east.id, pointIndex: 0 },
              { wayId: south.id, pointIndex: 1 },
              { wayId: north.id, pointIndex: 0 },
            ],
          },
        ],
        approachControls: { 'east:start': { control: 'stop' } },
      }),
      null,
      [],
      streetView(west),
    );

    const markers = features.junctions.features.filter(
      (feature) => property(feature, 'control') === 'stop',
    );
    expect(markers).toHaveLength(1);
    expect(property(markers[0], 'wayId')).toBe('east');
    expect(property(markers[0], 'end')).toBe('start');
    expect(
      features.laneMarkings.features.filter((feature) => property(feature, 'kind') === 'crosswalk'),
    ).toHaveLength(1);
  });

  it('preserves and paints a yield control distinctly from a stop', () => {
    const nodeCoord: LngLat = [-115.16, 36.14];
    const west = aRoad('west', [[-115.2, 36.14], nodeCoord]);
    const east = aRoad('east', [nodeCoord, [-115.12, 36.14]]);
    const persisted = aSystem({
      ways: [west, east],
      nodes: [
        {
          id: 'junction',
          coord: nodeCoord,
          control: 'yield',
          refs: [
            { wayId: west.id, pointIndex: 1 },
            { wayId: east.id, pointIndex: 0 },
          ],
        },
      ],
    });
    const system = parseSystem(JSON.parse(JSON.stringify(persisted)));
    const features = buildFeatures(system, null, [], streetView(west));
    const yieldMarker = features.junctions.features.find(
      (feature) => property(feature, 'control') === 'yield',
    );

    expect(system.nodes[0]?.control).toBe('yield');
    expect(yieldMarker?.geometry).toEqual({ type: 'Point', coordinates: system.nodes[0]?.coord });
    expect(property(yieldMarker, 'renderTier')).toBe('street');
    expect(
      features.laneMarkings.features.filter((feature) => {
        const kind = property(feature, 'kind');
        return kind === 'crosswalk' || kind === 'stopBar';
      }),
    ).toEqual([]);

    const staticScene = resolveStaticVisualScene({
      revision: 'yield-control',
      features,
      presentation: streetView(west).presentation,
    });
    expect(
      staticScene.visuals.find(
        (visual) => visual.kind === 'circle' && visual.featureId === String(yieldMarker?.id),
      ),
    ).toMatchObject({ kind: 'circle', color: '#d9a62e', radiusPx: 3.5 });
  });
});
