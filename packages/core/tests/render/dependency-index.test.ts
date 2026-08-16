import { describe, expect, it } from 'vitest';
import { laneRefKey } from '../../src/model/components';
import {
  dependencyClosure,
  namedWayLabelDependencyId,
  renderDependencyIndexFor,
  serviceSpanDependencyId,
} from '../../src/render/dependency-index';
import { dependencyInvalidationBetween } from '../../src/render/dependency-invalidation';
import { aPattern, aRoad, aService, aStop, aSystem } from '../support/fixtures.test';

// A Service owns one path with the same durable identity. Lines carry public
// naming and colour; they do not introduce a second path identifier.
const MAIN_SERVICE_PATH_ID = 'main-service';

function fixture() {
  const west = aRoad('west', [
    [0, 0],
    [1, 0],
  ]);
  const east = aRoad('east', [
    [1, 0],
    [2, 0],
  ]);
  const unrelated = aRoad('unrelated', [
    [10, 0],
    [11, 0],
  ]);
  const service = aService('main-service', [
    aPattern('main-pattern', [west, east], ['west', 'east']),
  ]);
  const otherService = aService('other-service', [
    aPattern('other-pattern', [unrelated], ['unrelated']),
  ]);
  return aSystem({
    ways: [west, east, unrelated],
    services: [service, otherService],
    nodes: [
      {
        id: 'main-junction',
        coord: [1, 0],
        refs: [
          { wayId: 'west', pointIndex: 1 },
          { wayId: 'east', pointIndex: 0 },
        ],
      },
      {
        id: 'unrelated-junction',
        coord: [10, 0],
        refs: [{ wayId: 'unrelated', pointIndex: 0 }],
      },
    ],
    stops: [
      aStop('nearby-stop', [0.5, 0.0001]),
      aStop('unrelated-stop', [10.5, 0], { wayId: 'unrelated', t: 0.5 }),
    ],
    namedWays: [
      { id: 'main-name', name: 'Main Street', wayIds: ['west', 'east'] },
      { id: 'other-name', name: 'Other Street', wayIds: ['unrelated'] },
    ],
  });
}

describe('renderer dependency index', () => {
  it('limits a corridor edit to its dependency closure', () => {
    const index = renderDependencyIndexFor(fixture());

    const closure = dependencyClosure(index, { wayIds: ['west'] });

    expect(closure.corridorIds).toEqual(['west', 'east']);
    expect(closure.junctionIds).toEqual(['main-junction']);
    expect(closure.connectorJunctionIds).toEqual(['main-junction']);
    expect(closure.serviceSpanIds).toEqual([
      serviceSpanDependencyId({
        serviceId: 'main-service',
        patternId: MAIN_SERVICE_PATH_ID,
        sectionIndex: 0,
        branch: 'shared',
        legIndex: 0,
      }),
      serviceSpanDependencyId({
        serviceId: 'main-service',
        patternId: MAIN_SERVICE_PATH_ID,
        sectionIndex: 0,
        branch: 'shared',
        legIndex: 1,
      }),
    ]);
    expect(closure.stopIds).toEqual(['nearby-stop']);
    expect(closure.labelIds).toEqual([namedWayLabelDependencyId('main-name', 'west')]);
    expect(closure.corridorIds).not.toContain('unrelated');
    expect(closure.junctionIds).not.toContain('unrelated-junction');
    expect(closure.stopIds).not.toContain('unrelated-stop');
  });

  it('keeps a service-only edit out of physical corridor geometry', () => {
    const index = renderDependencyIndexFor(fixture());

    const closure = dependencyClosure(index, { serviceIds: ['main-service'] });

    expect(closure.corridorIds).toEqual([]);
    expect(closure.junctionIds).toEqual([]);
    expect(closure.labelIds).toEqual([]);
    expect(closure.serviceSpanIds).toEqual([
      serviceSpanDependencyId({
        serviceId: 'main-service',
        patternId: MAIN_SERVICE_PATH_ID,
        sectionIndex: 0,
        branch: 'shared',
        legIndex: 0,
      }),
      serviceSpanDependencyId({
        serviceId: 'main-service',
        patternId: MAIN_SERVICE_PATH_ID,
        sectionIndex: 0,
        branch: 'shared',
        legIndex: 1,
      }),
    ]);
  });

  it('reaches incident corridors, connectors, and service spans from a junction edit', () => {
    const index = renderDependencyIndexFor(fixture());

    const closure = dependencyClosure(index, { nodeIds: ['main-junction'] });

    expect(closure.corridorIds).toEqual(['west', 'east']);
    expect(closure.junctionIds).toEqual(['main-junction']);
    expect(closure.connectorJunctionIds).toEqual(['main-junction']);
    expect(closure.serviceSpanIds).toEqual([
      serviceSpanDependencyId({
        serviceId: 'main-service',
        patternId: MAIN_SERVICE_PATH_ID,
        sectionIndex: 0,
        branch: 'shared',
        legIndex: 0,
      }),
      serviceSpanDependencyId({
        serviceId: 'main-service',
        patternId: MAIN_SERVICE_PATH_ID,
        sectionIndex: 0,
        branch: 'shared',
        legIndex: 1,
      }),
    ]);
  });

  it('routes a lane restriction to connectors and dependent service geometry', () => {
    const system = fixture();
    const westLaneId = system.ways[0].profile.lanes[0].id;
    const index = renderDependencyIndexFor(system);

    const closure = dependencyClosure(index, {
      turnRestrictionKeys: [laneRefKey('west', westLaneId)],
    });

    expect(closure.corridorIds).toEqual([]);
    expect(closure.connectorJunctionIds).toEqual(['main-junction']);
    expect(closure.serviceSpanIds).toEqual([
      serviceSpanDependencyId({
        serviceId: 'main-service',
        patternId: MAIN_SERVICE_PATH_ID,
        sectionIndex: 0,
        branch: 'shared',
        legIndex: 0,
      }),
    ]);
  });

  it('unions prior and next closures for removed and added entities', () => {
    const previous = fixture();
    const replacement = aRoad('replacement', [
      [20, 0],
      [21, 0],
    ]);
    const next = {
      ...previous,
      ways: [...previous.ways.filter(({ id }) => id !== 'west'), replacement],
      services: previous.services.filter(({ id }) => id !== 'main-service'),
      nodes: previous.nodes.filter(({ id }) => id !== 'main-junction'),
      stops: previous.stops.filter(({ id }) => id !== 'nearby-stop'),
      namedWays: previous.namedWays.filter(({ id }) => id !== 'main-name'),
    };

    const invalidation = dependencyInvalidationBetween(previous, next);

    expect(invalidation.corridorIds).toContain('west');
    expect(invalidation.corridorIds).toContain('replacement');
    expect(invalidation.junctionIds).toContain('main-junction');
    expect(invalidation.serviceSpanIds).toContain(
      serviceSpanDependencyId({
        serviceId: 'main-service',
        patternId: MAIN_SERVICE_PATH_ID,
        sectionIndex: 0,
        branch: 'shared',
        legIndex: 0,
      }),
    );
    expect(invalidation.labelIds).toContain(namedWayLabelDependencyId('main-name', 'west'));
  });

  it('reuses topology when every immutable render collection is retained', () => {
    const system = fixture();

    const first = renderDependencyIndexFor(system);
    const second = renderDependencyIndexFor({ ...system, description: 'Metadata only' });

    expect(second).toBe(first);
  });
});
