import { describe, expect, it } from 'vitest';
import type { PatternLeg, TransitSystem } from '../../../src/transit/authored-system';
import { migrateSchemaV16System } from '../../../src/model/schema-v17-system/migrate-v16';
import { validateAuthoredInfrastructureRelationships } from '../../../src/model/schema-v17-system/validate-infrastructure-relationships';
import { aPattern, aRoad, aService, aStop, aSystem } from '../../support/fixtures.test';

function infrastructureSystem(): TransitSystem {
  const way = aRoad('route-way', [
    [-115.2, 36.14],
    [-115.16, 36.14],
  ]);
  const service = aService('route-plan', [aPattern('route-pattern', [way], [way.id])]);
  const result = migrateSchemaV16System(
    aSystem({
      ways: [way],
      stops: [aStop('route-stop', [-115.18, 36.14], { wayId: way.id, t: 0.5 })],
      services: [service],
    }),
  );
  if (result.kind !== 'migrated') throw new Error('Infrastructure fixture did not migrate.');
  return result.system;
}

function firstLeg(system: TransitSystem): PatternLeg {
  const path = system.patterns[0].path;
  if (path.kind !== 'known') throw new Error('Infrastructure fixture path is unknown.');
  return path.legs[0];
}

describe('schema-v17 infrastructure relationships', () => {
  it('accepts the complete physical graph produced by v16 migration', () => {
    expect(() => validateAuthoredInfrastructureRelationships(infrastructureSystem())).not.toThrow();
  });

  it('requires each Way to own one existing Alignment exclusively', () => {
    const missing = infrastructureSystem();
    missing.ways[0].alignmentId = 'missing-alignment';
    expect(() => validateAuthoredInfrastructureRelationships(missing)).toThrow(/missing-alignment/);

    const duplicate = infrastructureSystem();
    duplicate.ways.push({ ...duplicate.ways[0], id: 'duplicate-way' });
    expect(() => validateAuthoredInfrastructureRelationships(duplicate)).toThrow(/two Ways/);
  });

  it('rejects a bare Alignment leg when a Way owns that Alignment', () => {
    const system = infrastructureSystem();
    const path = system.patterns[0].path;
    if (path.kind !== 'known') throw new Error('Infrastructure fixture path is unknown.');
    path.legs[0] = {
      kind: 'alignment',
      alignmentId: system.alignments[0].id,
      direction: 'forward',
      extent: { start: 0, end: 1 },
    };

    expect(() => validateAuthoredInfrastructureRelationships(system)).toThrow(/bare Alignment/);
  });

  it('requires pinned Pattern lanes to exist on their Way', () => {
    const system = infrastructureSystem();
    const leg = firstLeg(system);
    if (leg.kind !== 'way') throw new Error('Infrastructure fixture leg is not physical.');
    leg.lane = { kind: 'pinned', laneId: 'missing-lane' };

    expect(() => validateAuthoredInfrastructureRelationships(system)).toThrow(/missing-lane/);
  });

  it('validates Stop carrier and Station references', () => {
    const missingCarrier = infrastructureSystem();
    missingCarrier.stops[0].anchors[0].alignmentId = 'missing-alignment';
    expect(() => validateAuthoredInfrastructureRelationships(missingCarrier)).toThrow(
      /missing-alignment/,
    );

    const missingStation = infrastructureSystem();
    missingStation.stops[0].stationId = 'missing-station';
    expect(() => validateAuthoredInfrastructureRelationships(missingStation)).toThrow(
      /missing-station/,
    );
  });

  it('validates Node, NamedWay, and VehicleKind references', () => {
    const invalidNode = infrastructureSystem();
    invalidNode.nodes = [
      {
        id: 'node',
        coord: [-115.2, 36.14],
        refs: [{ wayId: 'missing-way', pointIndex: 0 }],
      },
    ];
    expect(() => validateAuthoredInfrastructureRelationships(invalidNode)).toThrow(/missing-way/);

    const invalidNamedWay = infrastructureSystem();
    invalidNamedWay.namedWays = [{ id: 'named-way', name: 'Named', wayIds: ['missing-way'] }];
    expect(() => validateAuthoredInfrastructureRelationships(invalidNamedWay)).toThrow(
      /missing-way/,
    );

    const invalidVehicle = infrastructureSystem();
    invalidVehicle.servicePlans[0].vehicleKindId = 'missing-vehicle';
    expect(() => validateAuthoredInfrastructureRelationships(invalidVehicle)).toThrow(
      /missing-vehicle/,
    );
  });
});
