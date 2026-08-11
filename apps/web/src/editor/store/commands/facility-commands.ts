import { pointInPolygon } from '@transitmapper/core/model/geo';
import {
  addGroupMember,
  createFacility,
  createGroup,
  moveFacility,
  setFacilityName,
} from '@transitmapper/core/model/system';
import { deleteSelection } from '@transitmapper/core/model/selection-deletion';
import type { LngLat, TransitSystem } from '@transitmapper/core/model/system';
import type { FacilityCommands } from '../contracts/place-commands';
import type { EditorRuntime } from '../runtime';

function isPolygon(geometry: LngLat | LngLat[]): geometry is LngLat[] {
  return Array.isArray(geometry[0]);
}

function centroidOf(ring: LngLat[]): LngLat | null {
  if (ring.length === 0) return null;
  return [
    ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
    ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
  ];
}

function addToHostComplex(
  system: TransitSystem,
  facilityId: string,
  geometry: LngLat | LngLat[],
): TransitSystem {
  const point = isPolygon(geometry) ? centroidOf(geometry) : geometry;
  if (!point) return system;
  const host = system.stations.find(
    (station) => station.footprint && pointInPolygon(point, station.footprint),
  );
  if (!host) return system;
  const group = system.groups.find((candidate) => candidate.memberIds.includes(host.id));
  if (group) return addGroupMember(system, group.id, facilityId);
  return {
    ...system,
    groups: [
      ...system.groups,
      createGroup([host.id, facilityId], host.name ? `${host.name} complex` : undefined),
    ],
  };
}

/** Creates the facility command surface once for one editor runtime. */
export function createFacilityCommands(runtime: EditorRuntime): FacilityCommands {
  return {
    addFacility(typeId, geometry) {
      return runtime.commitContent(null, ({ system }) => {
        const facility = createFacility(typeId, geometry);
        const withFacility: TransitSystem = {
          ...system,
          facilities: [...system.facilities, facility],
        };
        return {
          system: addToHostComplex(withFacility, facility.id, geometry),
          transient: { selection: { kind: 'facility', id: facility.id } },
          result: facility.id,
        };
      });
    },
    moveFacility: (id, geometry) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: moveFacility(system, id, geometry),
        result: undefined,
      })),
    setFacilityName: (id, name) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: setFacilityName(system, id, name),
        result: undefined,
      })),
    deleteFacility: (id) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: deleteSelection(system, [{ kind: 'facility', id }]),
        result: undefined,
      })),
  };
}
