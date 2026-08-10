import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '../../src/model/serialize';
import { osmElementsToWays } from '../../src/model/import';
import { oneSection, wholeLeg } from '../../src/model/geo';
import type { TransitSystem, Way } from '../../src/model/system';
import {
  buildFeatures,
  createFeatureBuildOperationCounts,
  type ViewOptions,
} from '../../src/render/buildFeatures';
import { aService } from '../support/fixtures.test';

const view = (zoom: number): ViewOptions => ({
  viewMode: 'infrastructure',
  visibleModes: new Set(),
  visibleWayTypes: new Set(['road', 'bike', 'heavyRail', 'lightRail']),
  zoom,
  laneDetail: zoom >= 15,
  bounds: [
    [-115.2, 36],
    [-115, 36.2],
  ],
});

function fixture() {
  const system = createEmptySystem();
  const ways = osmElementsToWays([
    {
      type: 'way',
      id: 1,
      tags: { highway: 'primary' },
      nodes: [1, 2],
      geometry: [
        { lat: 36.05, lon: -115.15 },
        { lat: 36.1, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'tertiary' },
      nodes: [3, 4],
      geometry: [
        { lat: 36.06, lon: -115.15 },
        { lat: 36.11, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 3,
      tags: { highway: 'residential' },
      nodes: [5, 6],
      geometry: [
        { lat: 36.07, lon: -115.15 },
        { lat: 36.12, lon: -115.1 },
      ],
    },
    {
      type: 'way',
      id: 4,
      tags: { highway: 'residential' },
      nodes: [7, 8],
      geometry: [
        { lat: 37, lon: -116 },
        { lat: 37.1, lon: -116.1 },
      ],
    },
  ]);
  const local = ways[2];
  system.ways = [
    ...ways,
    {
      ...local,
      id: 'hand-drawn',
      source: undefined,
      points: [
        [-116, 37],
        [-116.1, 37.1],
      ],
    },
  ];
  return system;
}

function requiredWay(system: TransitSystem, source: string): Way {
  const way = system.ways.find((candidate) => candidate.source === source);
  if (!way) throw new Error(`Expected fixture way ${source}.`);
  return way;
}

function featureId(properties: unknown): string | undefined {
  if (!properties || typeof properties !== 'object' || !('id' in properties)) return undefined;
  return typeof properties.id === 'string' ? properties.id : undefined;
}

function renderedIds(
  system: ReturnType<typeof fixture>,
  zoom: number,
  selection: { kind: string; id: string } | null = null,
) {
  return buildFeatures(system, selection, [], view(zoom)).ways.features.map((feature) =>
    featureId(feature.properties),
  );
}

describe('semantic infrastructure detail', () => {
  it('shows only imported arterials below zoom 11 while retaining hand-drawn and selected ways', () => {
    const system = fixture();
    const selectedLocal = requiredWay(system, 'osm:4');
    const ids = buildFeatures(
      system,
      { kind: 'way', id: selectedLocal.id },
      [],
      view(10),
    ).ways.features.map((feature) => featureId(feature.properties));

    expect(ids).toContain(requiredWay(system, 'osm:1').id);
    expect(ids).toContain('hand-drawn');
    expect(ids).toContain(selectedLocal.id);
    expect(ids).not.toContain(requiredWay(system, 'osm:2').id);
    expect(ids).not.toContain(requiredWay(system, 'osm:3').id);
  });

  it('adds collectors at zoom 11 and in-bounds local streets as one centerline at zoom 13', () => {
    const system = fixture();
    const collector = requiredWay(system, 'osm:2');
    const local = requiredWay(system, 'osm:3');

    expect(renderedIds(system, 12)).toContain(collector.id);
    const zoom13 = renderedIds(system, 13);
    expect(zoom13.filter((id) => id === local.id)).toHaveLength(1);
    expect(zoom13).not.toContain(requiredWay(system, 'osm:4').id);
  });

  it('does not apply OpenStreetMap detail filtering or viewport culling to GTFS ways', () => {
    const system = fixture();
    const gtfsWay: Way = {
      ...requiredWay(system, 'osm:4'),
      id: 'gtfs-way',
      source: 'gtfs:shape-1',
      classId: undefined,
    };
    system.ways.push(gtfsWay);

    expect(renderedIds(system, 10)).toContain(gtfsWay.id);
  });

  it('keeps a transit service visible when low zoom hides its imported local street', () => {
    const system = fixture();
    const local = requiredWay(system, 'osm:3');
    const service = aService('local-bus', [
      { id: 'local-pattern', sections: oneSection([wholeLeg(local.id)]) },
    ]);
    system.services = [service];
    const metroView = view(10);
    metroView.visibleModes = new Set([service.modeId]);

    const features = buildFeatures(system, null, [], metroView);

    expect(features.ways.features.map((feature) => featureId(feature.properties))).not.toContain(
      local.id,
    );
    expect(
      features.services.features.some(
        (feature) => feature.properties?.serviceId === service.id && !feature.properties.hitTarget,
      ),
    ).toBe(true);
  });

  it('creates regional GeoJSON only for ways inside padded bounds at Las Vegas import scale', () => {
    const system = createEmptySystem();
    const [template] = osmElementsToWays([
      {
        type: 'way',
        id: 1,
        tags: { highway: 'residential' },
        nodes: [1, 2],
        geometry: [
          { lat: 36, lon: -115 },
          { lat: 36.001, lon: -114.999 },
        ],
      },
    ]);
    system.ways = Array.from({ length: 83_144 }, (_unused, index) => {
      const x = index % 289;
      const y = Math.floor(index / 289);
      const longitude = -118 + x * 0.02;
      const latitude = 33 + y * 0.02;
      return {
        ...template,
        id: `way-${index}`,
        source: `osm:${index}`,
        points: [
          [longitude, latitude],
          [longitude + 0.001, latitude + 0.001],
        ],
      };
    });
    system.nodes = system.ways.map((way, index) => ({
      id: `node-${index}`,
      coord: way.points[0],
      refs: [{ wayId: way.id, pointIndex: 0 }],
      control: 'uncontrolled',
    }));
    const counts = createFeatureBuildOperationCounts();
    const regional = view(13);
    regional.bounds = [
      [-115.2, 36],
      [-115, 36.2],
    ];

    const features = buildFeatures(system, null, [], regional, null, null, { counts });

    // The 0.1-degree spatial buckets conservatively include their edge cells;
    // fewer than 300 candidates is the hand-checked ceiling for this fixture.
    expect(counts.featureTopologyWayVisitCount).toBeLessThan(300);
    expect(features.ways.features).toHaveLength(121);

    const detailCounts = createFeatureBuildOperationCounts();
    buildFeatures(system, null, [], view(15), null, null, { counts: detailCounts });
    expect(detailCounts.featureJunctionNodeVisitCount).toBeLessThan(300);
  });
});
