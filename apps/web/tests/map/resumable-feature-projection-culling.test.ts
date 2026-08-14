import { describe, expect, it } from 'vitest';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import {
  resetViewportIndexCacheDiagnostics,
  snapshotViewportIndexCacheDiagnostics,
} from '@transitmapper/core/render/viewport-index';
import {
  aPattern,
  aRoad,
  aService,
  aStation,
  aStop,
  aSystem,
} from '@transitmapper/core/testing/fixtures';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import {
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_JUNCTIONS,
  SRC_PHYSICAL_HANDLES,
  SRC_SERVICE_TERMINI,
  SRC_STATIONS,
  SRC_WAY_LABELS,
  SRC_WAYS,
} from '../../src/map/layers';
import { planResumableGeographicFeatureProjection } from '../../src/map/resumable-feature-projection';
import { buildFeaturesForSources } from '../../src/map/sourceFeatureProjection';

const view: RenderViewOptions = {
  viewMode: 'infrastructure',
  visibleModes: new Set(['bus']),
  visibleWayTypes: new Set(['road']),
  presentation: renderPresentationForViewport({
    center: [-115.18, 36.14],
    zoom: 18,
    width: 1_440,
    height: 900,
  }),
};

describe('resumable geographic feature projection culling', () => {
  it('plans bounded units only for visible primary candidates', () => {
    const visibleWest = aRoad('visible-west', [
      [-115.182, 36.14],
      [-115.18, 36.14],
    ]);
    const visibleEast = aRoad('visible-east', [
      [-115.18, 36.14],
      [-115.178, 36.14],
    ]);
    const offscreenWays = Array.from({ length: 80 }, (_, index) =>
      aRoad(`offscreen-${index}`, [
        [-114 + index * 0.001, 37],
        [-113.999 + index * 0.001, 37],
      ]),
    );
    const system = aSystem({
      ways: [visibleWest, visibleEast, ...offscreenWays],
      nodes: [
        {
          id: 'visible-junction',
          coord: [-115.18, 36.14],
          refs: [
            { wayId: visibleWest.id, pointIndex: 1 },
            { wayId: visibleEast.id, pointIndex: 0 },
          ],
        },
        ...offscreenWays.map((way, index) => ({
          id: `offscreen-junction-${index}`,
          coord: way.points[0],
          refs: [{ wayId: way.id, pointIndex: 0 }],
        })),
      ],
      stops: [
        aStop('visible-stop', [-115.181, 36.14], { wayId: visibleWest.id, t: 0.5 }),
        ...offscreenWays.map((way, index) =>
          aStop(`offscreen-stop-${index}`, way.points[0], { wayId: way.id, t: 0 }),
        ),
      ],
      namedWays: [
        { id: 'visible-label', name: 'Visible Street', wayIds: [visibleWest.id] },
        ...offscreenWays.map((way, index) => ({
          id: `offscreen-label-${index}`,
          name: `Offscreen ${index}`,
          wayIds: [way.id],
        })),
      ],
    });

    const plan = planResumableGeographicFeatureProjection({
      system,
      selection: null,
      handleWayIds: [],
      view,
      sourceIds: [SRC_WAYS, SRC_JUNCTIONS, SRC_STATIONS, SRC_WAY_LABELS],
      batchSizes: { corridors: 1, junctions: 1, stops: 1, labels: 1 },
    });

    expect(plan.kind).toBe('ready');
    if (plan.kind !== 'ready') throw new Error(plan.reason);
    expect(plan.units.map(({ primary }) => primary)).toEqual([
      { kind: 'corridor', ids: ['visible-west'] },
      { kind: 'corridor', ids: ['visible-east'] },
      { kind: 'junction', ids: ['visible-junction'] },
      { kind: 'stop', ids: ['visible-stop'] },
      { kind: 'label', ids: ['visible-label'] },
    ]);
    expect(plan.units.every((unit) => unit.primary.ids.length <= 1)).toBe(true);
    expect(
      plan.units.flatMap((unit) => unit.primary.ids).some((id) => id.includes('offscreen')),
    ).toBe(false);

    resetViewportIndexCacheDiagnostics();
    plan.units.forEach((unit) => unit.run());
    expect(snapshotViewportIndexCacheDiagnostics()).toEqual({
      buildCount: 0,
      cacheHitCount: 0,
    });
  });

  it('admits only visible handle, terminus, facility, and group singleton work', () => {
    const visibleWay = aRoad('visible-handles', [
      [-115.181, 36.14],
      [-115.179, 36.14],
    ]);
    const remoteWay = aRoad('remote-handles', [
      [-114, 37],
      [-113.999, 37],
    ]);
    const service = aService('mixed-service', [
      aPattern('visible-pattern', [visibleWay], [visibleWay.id]),
      aPattern('remote-pattern', [remoteWay], [remoteWay.id]),
    ]);
    const visibleStation = aStation('visible-physical', [-115.18, 36.14], {
      footprint: [
        [-115.1802, 36.1398],
        [-115.1798, 36.1398],
        [-115.1798, 36.1402],
      ],
    });
    const remoteStation = aStation('remote-physical', [-114, 37], {
      footprint: [
        [-114.0002, 36.9998],
        [-113.9998, 36.9998],
        [-113.9998, 37.0002],
      ],
    });
    const system = aSystem({
      ways: [visibleWay, remoteWay],
      services: [service],
      stations: [visibleStation, remoteStation],
      facilities: [
        { id: 'visible-facility', typeId: 'entrance', geometry: [-115.18, 36.14] },
        { id: 'remote-facility', typeId: 'entrance', geometry: [-114, 37] },
      ],
      groups: [
        {
          id: 'visible-group',
          memberIds: [visibleStation.id, 'visible-facility'],
          footprint: [
            [-115.1803, 36.1397],
            [-115.1797, 36.1397],
            [-115.1797, 36.1403],
          ],
        },
        {
          id: 'remote-group',
          memberIds: [remoteStation.id, 'remote-facility'],
          footprint: [
            [-114.0003, 36.9997],
            [-113.9997, 36.9997],
            [-113.9997, 37.0003],
          ],
        },
      ],
    });
    const options = {
      system,
      selection: { kind: 'service' as const, id: service.id },
      handleWayIds: [visibleWay.id, remoteWay.id],
      view,
      sourceIds: [
        SRC_HANDLES,
        SRC_SERVICE_TERMINI,
        SRC_FACILITIES,
        SRC_FOOTPRINTS,
        SRC_PHYSICAL_HANDLES,
      ] as const,
      physicalHandleStationId: visibleStation.id,
      physicalHandleGroupId: 'visible-group',
    };
    const full = buildFeaturesForSources(options);
    const plan = planResumableGeographicFeatureProjection(options);

    expect(plan.kind).toBe('ready');
    if (plan.kind !== 'ready') throw new Error(plan.reason);
    expect(plan.aggregate(plan.units.map((unit) => unit.run()))).toEqual(full);
    expect(plan.units.every((unit) => unit.primary.ids.length === 1)).toBe(true);
    expect(JSON.stringify(plan.units.map(({ primary }) => primary))).not.toContain('remote-');
    expect(JSON.stringify(full)).not.toContain('remote-');
    expect(plan.units.filter((unit) => unit.primary.kind === 'handle')).toHaveLength(2);
    expect(
      plan.units.filter((unit) => unit.primary.kind === 'physical-station-handle'),
    ).toHaveLength(3);
    expect(plan.units.filter((unit) => unit.primary.kind === 'physical-group-handle')).toHaveLength(
      3,
    );
    expect(plan.units.filter((unit) => unit.primary.kind === 'service')).toHaveLength(1);
    expect(plan.units.filter((unit) => unit.primary.kind === 'facility')).toHaveLength(1);
    expect(plan.units.filter((unit) => unit.primary.kind === 'group')).toHaveLength(1);
  });
});
