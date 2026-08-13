import { describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import type {
  Facility,
  Group,
  Node,
  Station,
  Stop,
  TransitSystem,
  Way,
} from '@transitmapper/core/model/system';
import {
  createGestureProjectionController,
  createProjectionOperationCounts,
  recordFullProjection,
  recordSourceUpload,
} from '../../src/map/gestureProjection';
import {
  LAYER_SPECS,
  LYR_GESTURE_FILL,
  LYR_GESTURE_LINE,
  LYR_GESTURE_POINT,
  LYR_GESTURE_STROKE,
  SRC_GESTURE,
} from '../../src/map/layers';
const fixedWay: Way = {
  id: 'fixed-way',
  typeId: 'road',
  geometry: 'straight',
  grade: 'atGrade',
  profile: defaultProfileFor('road'),
  points: [
    [-115.3, 36.1],
    [-115.2, 36.1],
  ],
};

const movedWay: Way = {
  ...fixedWay,
  id: 'moved-way',
  points: [
    [-115.25, 36.12],
    [-115.2, 36.12],
    [-115.15, 36.12],
  ],
};

const fixedStop: Stop = {
  id: 'fixed-stop',
  coord: [-115.3, 36.1],
  anchors: [],
};

const movedStop: Stop = {
  id: 'moved-stop',
  coord: [-115.2, 36.12],
  anchors: [{ wayId: movedWay.id, t: 0.5 }],
};

const movedStation: Station = {
  id: 'moved-station',
  coord: [-115.2, 36.12],
  footprint: [
    [-115.205, 36.115],
    [-115.195, 36.115],
    [-115.195, 36.125],
    [-115.205, 36.125],
  ],
};

const movedFacility: Facility = {
  id: 'moved-facility',
  typeId: 'entrance',
  geometry: [-115.2, 36.12],
};

const movedGroup: Group = {
  id: 'moved-group',
  memberIds: [],
  color: '#e4572e',
  footprint: [
    [-115.21, 36.11],
    [-115.19, 36.11],
    [-115.19, 36.13],
    [-115.21, 36.13],
  ],
};

function baselineSystem(): TransitSystem {
  return {
    ...createEmptySystem(),
    ways: [movedWay, fixedWay],
    stops: [movedStop, fixedStop],
    stations: [movedStation],
    facilities: [movedFacility],
    groups: [movedGroup],
  };
}

describe('active-gesture map projection', () => {
  it('expands an explicit dragged point once and aborts on a document switch', () => {
    const joinedNode: Node = {
      id: 'joined-node',
      coord: movedWay.points[1],
      refs: [
        { wayId: movedWay.id, pointIndex: 1 },
        { wayId: fixedWay.id, pointIndex: 0 },
      ],
    };
    const baseline = { ...baselineSystem(), nodes: [joinedNode] };
    const counts = createProjectionOperationCounts();
    const controller = createGestureProjectionController(
      baseline,
      { wayPoints: [{ wayId: movedWay.id, pointIndex: 1 }] },
      counts,
    );

    expect(controller.affected()).toEqual({
      wayIds: ['moved-way', 'fixed-way'],
      stopIds: ['moved-stop'],
      stationIds: [],
      facilityIds: [],
      groupIds: [],
      nodeIds: ['joined-node'],
    });

    const switched = {
      ...baseline,
      id: 'different-document',
      ways: baseline.ways.map((way) => ({ ...way })),
    };

    expect(controller.project(switched)).toEqual({ kind: 'abort' });
    expect(controller.finish()).toEqual({ rebuild: true, hadPreview: false });
  });

  it('aborts a same-document bulk mutation instead of uploading it as a drag preview', () => {
    const baseline = baselineSystem();
    const controller = createGestureProjectionController(
      baseline,
      { wayIds: [movedWay.id] },
      createProjectionOperationCounts(),
    );
    const concurrentImport: TransitSystem = {
      ...baseline,
      ways: [
        { ...movedWay, points: movedWay.points.map(([lng, lat]) => [lng + 0.01, lat]) },
        fixedWay,
        { ...fixedWay, id: 'unexpected-imported-way' },
      ],
    };

    expect(controller.project(concurrentImport)).toEqual({ kind: 'abort' });
  });

  it('renders every scratch geometry through one dedicated source', () => {
    expect(
      LAYER_SPECS.filter((layer) => 'source' in layer && layer.source === SRC_GESTURE).map(
        (layer) => ({ id: layer.id, type: layer.type }),
      ),
    ).toEqual([
      { id: LYR_GESTURE_FILL, type: 'fill' },
      { id: LYR_GESTURE_STROKE, type: 'line' },
      { id: LYR_GESTURE_LINE, type: 'line' },
      { id: LYR_GESTURE_POINT, type: 'circle' },
    ]);
  });

  it('projects only entities whose geometry changed during the gesture', () => {
    const before = baselineSystem();
    const after: TransitSystem = {
      ...before,
      ways: [
        {
          ...movedWay,
          points: [
            [-115.24, 36.13],
            [-115.19, 36.13],
            [-115.14, 36.13],
          ],
        },
        fixedWay,
      ],
      stops: [
        {
          ...movedStop,
          coord: [-115.19, 36.13],
        },
        fixedStop,
      ],
      stations: [
        {
          ...movedStation,
          footprint: movedStation.footprint?.map(([lng, lat]) => [lng + 0.01, lat + 0.01]),
        },
      ],
      facilities: [
        {
          ...movedFacility,
          geometry: [-115.19, 36.13],
        },
      ],
      groups: [
        {
          ...movedGroup,
          footprint: movedGroup.footprint?.map(([lng, lat]) => [lng + 0.01, lat + 0.01]),
        },
      ],
    };
    const counts = createProjectionOperationCounts();

    const controller = createGestureProjectionController(
      before,
      {
        wayIds: ['moved-way'],
        stopIds: ['moved-stop'],
        stationIds: ['moved-station'],
        facilityIds: ['moved-facility'],
        groupIds: ['moved-group'],
      },
      counts,
    );
    const result = controller.project(after);
    expect(result.kind).toBe('preview');
    if (result.kind !== 'preview') throw new Error('expected a gesture preview');
    const projection = result.projection;

    expect(projection.affected).toEqual({
      wayIds: ['moved-way'],
      stopIds: ['moved-stop'],
      stationIds: ['moved-station'],
      facilityIds: ['moved-facility'],
      groupIds: ['moved-group'],
      nodeIds: [],
    });
    expect(
      projection.data.features.map((feature) => {
        const kind: unknown = feature.properties?.kind;
        const ownerId: unknown = feature.properties?.ownerId;
        return { kind, ownerId, geometry: feature.geometry.type };
      }),
    ).toEqual([
      { kind: 'way', ownerId: 'moved-way', geometry: 'LineString' },
      { kind: 'control', ownerId: 'moved-way', geometry: 'Point' },
      { kind: 'control', ownerId: 'moved-way', geometry: 'Point' },
      { kind: 'control', ownerId: 'moved-way', geometry: 'Point' },
      { kind: 'stop', ownerId: 'moved-stop', geometry: 'Point' },
      { kind: 'footprint', ownerId: 'moved-station', geometry: 'Polygon' },
      { kind: 'control', ownerId: 'moved-station', geometry: 'Point' },
      { kind: 'control', ownerId: 'moved-station', geometry: 'Point' },
      { kind: 'control', ownerId: 'moved-station', geometry: 'Point' },
      { kind: 'control', ownerId: 'moved-station', geometry: 'Point' },
      { kind: 'facility', ownerId: 'moved-facility', geometry: 'Point' },
      { kind: 'footprint', ownerId: 'moved-group', geometry: 'Polygon' },
      { kind: 'control', ownerId: 'moved-group', geometry: 'Point' },
      { kind: 'control', ownerId: 'moved-group', geometry: 'Point' },
      { kind: 'control', ownerId: 'moved-group', geometry: 'Point' },
      { kind: 'control', ownerId: 'moved-group', geometry: 'Point' },
    ]);
    expect(
      projection.data.features.some((feature) => feature.properties?.ownerId === 'fixed-way'),
    ).toBe(false);
    expect(
      projection.data.features.some((feature) => feature.properties?.ownerId === 'fixed-stop'),
    ).toBe(false);
    expect(counts).toEqual({
      fullProjectionCount: 0,
      gestureProjectionCount: 1,
      sourceUploadCount: 0,
      entityComparisonCount: 5,
      projectedEntityCount: 5,
    });
  });

  it('keeps drag frames to one scratch upload and defers one full projection until commit', () => {
    const baseline = baselineSystem();
    const counts = createProjectionOperationCounts();
    const controller = createGestureProjectionController(
      baseline,
      { wayIds: [movedWay.id] },
      counts,
    );
    let current = baseline;

    // Mousedown swaps the settled feature for an equivalent scratch feature
    // before the first movement, so filtering the old source cannot blink.
    expect(controller.project(baseline).kind).toBe('preview');
    recordSourceUpload(counts);

    for (let frame = 1; frame <= 5; frame++) {
      current = {
        ...current,
        ways: current.ways.map((way) =>
          way.id === movedWay.id
            ? {
                ...way,
                points: way.points.map(([lng, lat]) => [lng + 0.001, lat + 0.001]),
              }
            : way,
        ),
      };
      expect(controller.project(current).kind).toBe('preview');
      recordSourceUpload(counts);
    }

    recordSourceUpload(counts); // clearing the scratch source at gesture end
    recordFullProjection(counts, 15);

    expect(counts).toEqual({
      fullProjectionCount: 1,
      gestureProjectionCount: 6,
      sourceUploadCount: 22,
      entityComparisonCount: 12,
      projectedEntityCount: 12,
    });
    // Before this path, the same five frames each ran buildFeatures and
    // uploaded all fifteen derived sources: five full projects / 75 uploads.
    expect(counts.fullProjectionCount).toBeLessThan(5);
    expect(counts.sourceUploadCount).toBeLessThan(75);
  });
});
