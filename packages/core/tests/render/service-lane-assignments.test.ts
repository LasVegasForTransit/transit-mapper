import { describe, expect, it } from 'vitest';
import { wayById } from '../../src/model/geo';
import { wayLaneGeometry } from '../../src/geometry/streets';
import {
  assignServicesToLanes,
  indexServicePatternsByWay,
  laneServiceAssignmentKey,
} from '../../src/render/service-lane-assignments';
import { aPattern, aRoad, aService } from '../support/fixtures.test';

describe('service lane assignments', () => {
  it('keeps each directional run with the lane it actually rides', () => {
    const road = aRoad('arterial', [
      [-115.2, 36.1],
      [-115.2, 36.2],
    ]);
    const service = aService('bus', [aPattern('route', [road], [road.id])]);
    const lanes = wayLaneGeometry(road).lanes;
    const laneById = new Map(lanes.map((lane) => [lane.laneId, lane]));
    const entries = indexServicePatternsByWay(new Map([[road.id, [service]]])).get(road.id);

    expect(entries).toBeDefined();
    if (!entries) return;

    const assignments = assignServicesToLanes({
      entries,
      laneById,
      waysById: wayById([road]),
      turnRestrictions: {},
    });

    expect(assignments.servicesByLane.size).toBe(2);
    expect(
      [...assignments.runsByLaneAndService.values()].flatMap((runs) => [...runs]).sort(),
    ).toEqual(['inbound', 'outbound']);
    expect(assignments.resolvedServiceIds).toEqual(new Set([service.id]));
    expect(laneServiceAssignmentKey(lanes[0].laneId, service.id)).toContain(service.id);
  });
});
