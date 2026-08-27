import { describe, expect, it } from 'vitest';
import { renderDomainIdentity } from '@transitmapper/core/render/render-identity';
import { namedWayLabelDependencyId } from '@transitmapper/core/render/dependency-index';
import { aPattern, aRoad, aService, aStation, aSystem } from '@transitmapper/core/testing/fixtures';
import type { RenderPreparedSnapshot } from '@transitmapper/core/render/render-preparation';
import {
  planEntityRenderUpdate,
  planPreparedLiveEntityRenderUpdate,
} from '../src/projection/entity-render-update';
import {
  SRC_CONNECTORS,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_JUNCTIONS,
  SRC_LANE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_LANES,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_SERVICE_ARROWS,
  SRC_SERVICE_TERMINI,
  SRC_SERVICES,
  SRC_WAY_LABELS,
  SRC_WAYS,
} from '../src/layers/constants';
import { sourceUploadsForSystemChange } from '../src/sourceUploadPlan';

function corridorFixture() {
  const west = aRoad('west', [
    [-115.2, 36.14],
    [-115.18, 36.14],
  ]);
  const east = aRoad('east', [
    [-115.18, 36.14],
    [-115.16, 36.14],
  ]);
  const service = aService('main-service', [
    aPattern('main-pattern', [west, east], [west.id, east.id]),
  ]);
  return aSystem({
    ways: [west, east],
    services: [service],
    nodes: [
      {
        id: 'main-junction',
        coord: west.points[1],
        refs: [
          { wayId: west.id, pointIndex: 1 },
          { wayId: east.id, pointIndex: 0 },
        ],
      },
    ],
    stations: [aStation('main-station', [-115.19, 36.14005])],
    namedWays: [{ id: 'main-name', name: 'Main Street', wayIds: [west.id, east.id] }],
  });
}

function scopedPlan(
  previous: ReturnType<typeof corridorFixture>,
  next: ReturnType<typeof corridorFixture>,
) {
  const plan = planEntityRenderUpdate({
    previous,
    next,
    viewMode: 'infrastructure',
    requestedSourceIds: sourceUploadsForSystemChange(previous, next),
  });
  expect(plan.kind).toBe('scoped');
  if (plan.kind !== 'scoped') throw new Error(`expected scoped plan, received ${plan.reason}`);
  return plan;
}

describe('entity-scoped live render update planning', () => {
  const prepared = (
    system: ReturnType<typeof corridorFixture>,
    kind: RenderPreparedSnapshot['diagnostics']['kind'],
    fullProjectionReason?: RenderPreparedSnapshot['fullProjectionReason'],
  ) =>
    ({ system, diagnostics: { kind }, fullProjectionReason }) as unknown as RenderPreparedSnapshot;

  it('falls back to full requested sources when a camera plan follows a canceled edit', () => {
    const previous = corridorFixture();
    const edited = {
      ...previous,
      ways: previous.ways.map((way) =>
        way.id === 'west'
          ? { ...way, points: [[-115.201, 36.141], way.points[1]] as typeof way.points }
          : way,
      ),
    };

    expect(
      planPreparedLiveEntityRenderUpdate({
        intent: 'incremental',
        transition: { previous, next: edited },
        system: edited,
        viewMode: 'infrastructure',
        requestedSourceIds: [SRC_WAYS],
        lastLivePreparedSnapshot: prepared(previous, 'cold'),
        // Preparation for the edit committed, projection was canceled, and a
        // later camera plan now has no edit invalidation of its own.
        nextPreparedSnapshot: prepared(edited, 'camera'),
      }),
    ).toBeNull();
  });

  it('falls back to full requested sources for a cold same-document service edit', () => {
    const previous = corridorFixture();
    const edited = {
      ...previous,
      services: previous.services.map((service) => ({ ...service, color: '#336699' })),
    };

    expect(
      planPreparedLiveEntityRenderUpdate({
        intent: 'incremental',
        transition: { previous, next: edited },
        system: edited,
        viewMode: 'network',
        requestedSourceIds: [SRC_SERVICES],
        lastLivePreparedSnapshot: prepared(previous, 'cold'),
        nextPreparedSnapshot: prepared(edited, 'cold', 'service-bundle-allocation'),
      }),
    ).toEqual({
      kind: 'full',
      reason: 'service-bundle-allocation',
      sourceIds: [SRC_SERVICES],
    });
  });

  it('maps a corridor closure to exact source replacement domains', () => {
    const previous = corridorFixture();
    const next = {
      ...previous,
      ways: previous.ways.map((way) =>
        way.id === 'west'
          ? { ...way, points: [[-115.201, 36.141], way.points[1]] as typeof way.points }
          : way,
      ),
    };
    const plan = scopedPlan(previous, next);
    const wayDomains = [renderDomainIdentity('way', 'west'), renderDomainIdentity('way', 'east')];

    expect(plan.sourceIds).toEqual([
      SRC_WAYS,
      SRC_SERVICES,
      SRC_HANDLES,
      SRC_SERVICE_TERMINI,
      SRC_LANES,
      SRC_LANE_MARKINGS,
      SRC_LANE_ARROWS,
      SRC_SERVICE_ARROWS,
      SRC_JUNCTIONS,
      SRC_CONNECTORS,
      SRC_WAY_LABELS,
    ]);
    expect(plan.replacementDomainsBySource.get(SRC_WAYS)).toEqual(wayDomains);
    expect(plan.replacementDomainsBySource.get(SRC_SERVICES)).toEqual(wayDomains);
    expect(plan.replacementDomainsBySource.get(SRC_SERVICE_TERMINI)).toEqual([
      renderDomainIdentity('service', 'main-service'),
    ]);
    expect(plan.replacementDomainsBySource.get(SRC_JUNCTIONS)).toEqual([
      renderDomainIdentity('node', 'main-junction'),
    ]);
    expect(plan.replacementDomainsBySource.get(SRC_CONNECTORS)).toEqual([
      renderDomainIdentity('node', 'main-junction'),
    ]);
    expect(plan.replacementDomainsBySource.get(SRC_WAY_LABELS)).toEqual([
      renderDomainIdentity('labelDependency', namedWayLabelDependencyId('main-name', 'west')),
    ]);
  });

  it('uses the service domain for a safe service-only edit without replacing shared ways', () => {
    const previous = corridorFixture();
    const next = {
      ...previous,
      services: previous.services.map((service) => ({ ...service, color: '#336699' })),
    };
    const plan = scopedPlan(previous, next);

    expect(plan.sourceIds).toEqual([SRC_SERVICES, SRC_SERVICE_TERMINI, SRC_SERVICE_ARROWS]);
    expect(plan.replacementDomainsBySource.get(SRC_SERVICES)).toEqual([
      renderDomainIdentity('service', 'main-service'),
    ]);
    expect(plan.replacementDomainsBySource.get(SRC_SERVICE_ARROWS)).toEqual([
      renderDomainIdentity('service', 'main-service'),
    ]);
    expect(plan.replacementDomainsBySource.has(SRC_WAYS)).toBe(false);
    expect(plan.replacementDomainsBySource.has(SRC_HANDLES)).toBe(false);
    expect(plan.replacementDomainsBySource.has(SRC_LANE_ARROWS)).toBe(false);
  });

  it('keeps removed station ownership while projecting no nonexistent station', () => {
    const previous = corridorFixture();
    const next = { ...previous, stations: [] };
    const plan = scopedPlan(previous, next);
    const stationDomain = [renderDomainIdentity('station', 'main-station')];

    expect(plan.sourceIds).toEqual([SRC_FOOTPRINTS, SRC_PLATFORMS, SRC_PHYSICAL_HANDLES]);
    for (const sourceId of plan.sourceIds) {
      expect(plan.replacementDomainsBySource.get(sourceId)).toEqual(stationDomain);
    }
    expect(plan.projectionScope.candidates.stationIds).toEqual([]);
    expect(plan.projectionScope.replacement.stationIds).toEqual(['main-station']);
  });

  it('addresses removed named-way members through exact label dependency identities', () => {
    const previous = corridorFixture();
    const next = {
      ...previous,
      namedWays: [{ ...previous.namedWays[0], wayIds: ['east'] }],
    };
    const plan = scopedPlan(previous, next);

    expect(plan.sourceIds).toEqual([SRC_WAY_LABELS]);
    expect(plan.replacementDomainsBySource.get(SRC_WAY_LABELS)).toEqual([
      renderDomainIdentity('labelDependency', namedWayLabelDependencyId('main-name', 'west')),
      renderDomainIdentity('labelDependency', namedWayLabelDependencyId('main-name', 'east')),
    ]);
    expect(plan.projectionScope.candidates.labelDependencyIds).toEqual([
      namedWayLabelDependencyId('main-name', 'east'),
    ]);
  });

  it('falls back to source-authoritative projection for nonlocal or unsupported changes', () => {
    const previous = corridorFixture();
    const addedService = {
      ...previous,
      services: [...previous.services, aService('second-service', [])],
    };
    const facilityChange = {
      ...previous,
      facilities: [
        ...previous.facilities,
        {
          id: 'facility',
          name: 'Facility',
          typeId: 'maintenance' as const,
          geometry: [-115.19, 36.14] as [number, number],
        },
      ],
    };

    expect(
      planEntityRenderUpdate({
        previous,
        next: addedService,
        viewMode: 'network',
        requestedSourceIds: sourceUploadsForSystemChange(previous, addedService),
      }),
    ).toMatchObject({ kind: 'full', reason: 'service-bundle-allocation' });
    expect(
      planEntityRenderUpdate({
        previous,
        next: previous,
        viewMode: 'diagram',
        requestedSourceIds: [SRC_WAYS],
      }),
    ).toEqual({ kind: 'full', reason: 'diagram', sourceIds: [SRC_WAYS] });
    expect(
      planEntityRenderUpdate({
        previous,
        next: facilityChange,
        viewMode: 'infrastructure',
        requestedSourceIds: [SRC_FACILITIES],
      }),
    ).toEqual({
      kind: 'full',
      reason: 'unsupported-domain',
      sourceIds: [SRC_FACILITIES],
    });
  });
});
