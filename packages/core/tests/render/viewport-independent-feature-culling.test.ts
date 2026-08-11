import { describe, expect, it } from 'vitest';
import type { TransitSystem } from '../../src/model/system';
import {
  buildFeatures,
  createFeatureBuildOperationCounts,
  type RenderViewOptions,
} from '../../src/render/buildFeatures';
import { renderPresentationForViewport } from '../../src/render/render-presentation';
import { aPattern, aRoad, aService, aStation, aSystem } from '../support/fixtures.test';

const VISIBLE_CENTER = [-122.446, 37.758] as const;
const REMOTE_CENTER = [-122.419, 37.78] as const;

const view: RenderViewOptions = {
  viewMode: 'infrastructure',
  visibleModes: new Set(['bus']),
  visibleWayTypes: new Set(['road']),
  presentation: renderPresentationForViewport({
    center: [...VISIBLE_CENTER],
    zoom: 17.5,
    width: 1_440,
    height: 900,
  }),
};

interface CullingFixture {
  system: TransitSystem;
  visibleWayId: string;
  remoteWayId: string;
  visibleServiceId: string;
  remoteServiceId: string;
  visibleStationId: string;
  remoteStationId: string;
  visibleGroupId: string;
  remoteGroupId: string;
}

function cullingFixture(): CullingFixture {
  const visibleWay = aRoad('visible-trunk', [
    [VISIBLE_CENTER[0] - 0.001, VISIBLE_CENTER[1]],
    [VISIBLE_CENTER[0] + 0.001, VISIBLE_CENTER[1]],
  ]);
  const remoteWay = aRoad('remote-trunk', [
    [REMOTE_CENTER[0] - 0.001, REMOTE_CENTER[1]],
    [REMOTE_CENTER[0] + 0.001, REMOTE_CENTER[1]],
  ]);
  const visibleService = aService('visible-service', [
    aPattern('visible-pattern', [visibleWay], [visibleWay.id]),
  ]);
  const remoteService = aService('remote-service', [
    aPattern('remote-pattern', [remoteWay], [remoteWay.id]),
  ]);
  const visibleStation = aStation('visible-station', [...VISIBLE_CENTER], undefined, {
    footprint: [
      [VISIBLE_CENTER[0] - 0.0002, VISIBLE_CENTER[1] - 0.0002],
      [VISIBLE_CENTER[0] + 0.0002, VISIBLE_CENTER[1] - 0.0002],
      [VISIBLE_CENTER[0] + 0.0002, VISIBLE_CENTER[1] + 0.0002],
    ],
    platforms: [
      {
        id: 'visible-platform',
        points: [
          [VISIBLE_CENTER[0] - 0.0001, VISIBLE_CENTER[1] - 0.0001],
          [VISIBLE_CENTER[0] + 0.0001, VISIBLE_CENTER[1] - 0.0001],
          [VISIBLE_CENTER[0] + 0.0001, VISIBLE_CENTER[1] + 0.0001],
        ],
      },
    ],
  });
  const remoteStation = aStation('remote-station', [...REMOTE_CENTER], undefined, {
    footprint: [
      [REMOTE_CENTER[0] - 0.0002, REMOTE_CENTER[1] - 0.0002],
      [REMOTE_CENTER[0] + 0.0002, REMOTE_CENTER[1] - 0.0002],
      [REMOTE_CENTER[0] + 0.0002, REMOTE_CENTER[1] + 0.0002],
    ],
  });
  const visibleGroupId = 'visible-complex';
  const remoteGroupId = 'remote-complex';
  return {
    system: aSystem({
      ways: [visibleWay, remoteWay],
      services: [visibleService, remoteService],
      stations: [visibleStation, remoteStation],
      facilities: [
        { id: 'visible-entrance', typeId: 'entrance', geometry: [...VISIBLE_CENTER] },
        { id: 'remote-entrance', typeId: 'entrance', geometry: [...REMOTE_CENTER] },
      ],
      groups: [
        {
          id: visibleGroupId,
          memberIds: [visibleStation.id, 'visible-entrance'],
          footprint: [
            [VISIBLE_CENTER[0] - 0.0003, VISIBLE_CENTER[1] - 0.0003],
            [VISIBLE_CENTER[0] + 0.0003, VISIBLE_CENTER[1] - 0.0003],
            [VISIBLE_CENTER[0] + 0.0003, VISIBLE_CENTER[1] + 0.0003],
          ],
        },
        {
          id: remoteGroupId,
          memberIds: [remoteStation.id, 'remote-entrance'],
          footprint: [
            [REMOTE_CENTER[0] - 0.0003, REMOTE_CENTER[1] - 0.0003],
            [REMOTE_CENTER[0] + 0.0003, REMOTE_CENTER[1] - 0.0003],
            [REMOTE_CENTER[0] + 0.0003, REMOTE_CENTER[1] + 0.0003],
          ],
        },
      ],
    }),
    visibleWayId: visibleWay.id,
    remoteWayId: remoteWay.id,
    visibleServiceId: visibleService.id,
    remoteServiceId: remoteService.id,
    visibleStationId: visibleStation.id,
    remoteStationId: remoteStation.id,
    visibleGroupId,
    remoteGroupId,
  };
}

describe('viewport culling for independent feature passes', () => {
  it('projects only visible selected-way control points and reports one way visit', () => {
    const { system, visibleWayId, remoteWayId } = cullingFixture();
    const counts = createFeatureBuildOperationCounts();

    const features = buildFeatures(system, null, [visibleWayId, remoteWayId], view, null, null, {
      requestedFeatures: ['handles'],
      counts,
    });

    expect(features.handles.features.map((feature) => feature.geometry.coordinates)).toEqual(
      system.ways[0].points,
    );
    expect(counts.featureHandleWayVisitCount).toBe(1);
  });

  it('does not project offscreen termini for the selected service', () => {
    const { system, visibleServiceId, remoteServiceId } = cullingFixture();

    const visible = buildFeatures(
      system,
      { kind: 'service', id: visibleServiceId },
      [],
      view,
      null,
      null,
      { requestedFeatures: ['serviceTermini'] },
    );
    const remote = buildFeatures(
      system,
      { kind: 'service', id: remoteServiceId },
      [],
      view,
      null,
      null,
      { requestedFeatures: ['serviceTermini'] },
    );

    expect(visible.serviceTermini.features).toHaveLength(2);
    expect(remote.serviceTermini.features).toEqual([]);
  });

  it('resolves visible facilities directly without visiting the remote collection member', () => {
    const { system } = cullingFixture();
    const counts = createFeatureBuildOperationCounts();

    const features = buildFeatures(system, null, [], view, null, null, {
      requestedFeatures: ['facilities'],
      counts,
    });

    expect(features.facilities.features.map((feature) => feature.geometry.coordinates)).toEqual([
      [...VISIBLE_CENTER],
    ]);
    expect(counts.featureFacilityVisitCount).toBe(1);
  });

  it('omits remote physical groups and selected physical vertices before projection', () => {
    const { system, visibleStationId, remoteStationId, visibleGroupId, remoteGroupId } =
      cullingFixture();
    const counts = createFeatureBuildOperationCounts();

    const remoteSelection = buildFeatures(system, null, [], view, remoteStationId, remoteGroupId, {
      requestedFeatures: ['footprints', 'platforms', 'physicalHandles'],
      counts,
    });
    const visibleSelection = buildFeatures(
      system,
      null,
      [],
      view,
      visibleStationId,
      visibleGroupId,
      { requestedFeatures: ['physicalHandles'] },
    );

    expect(remoteSelection.footprints.features.map((feature) => String(feature.id))).toEqual([
      expect.stringContaining(visibleStationId),
      expect.stringContaining(visibleGroupId),
    ]);
    expect(remoteSelection.platforms.features.map((feature) => String(feature.id))).toEqual([
      expect.stringContaining(visibleStationId),
    ]);
    expect(remoteSelection.physicalHandles.features).toEqual([]);
    expect(JSON.stringify(remoteSelection)).not.toContain('remote-');
    expect(counts).toMatchObject({
      featurePhysicalStationVisitCount: 1,
      featurePhysicalGroupVisitCount: 1,
    });
    expect(visibleSelection.physicalHandles.features.length).toBeGreaterThan(0);
    expect(
      visibleSelection.physicalHandles.features.every((feature) =>
        String(feature.id).includes('visible-'),
      ),
    ).toBe(true);
  });
});
