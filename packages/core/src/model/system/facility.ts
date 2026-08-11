import { shortId } from '../ids';
import type { LngLat } from './valueTypes';

/** A catalog-typed point/area feature: bike dock, entrance, depot, … */
export interface Facility {
  id: string;
  /** Facility-type catalog id. */
  typeId: string;
  name?: string;
  /** A single point, or a polygon boundary. */
  geometry: LngLat | LngLat[];
}

/** A new facility of the given catalog type at `geometry` — the one place a
 *  bare Facility literal gets constructed, including from editor facility
 *  commands. */
export function createFacility(typeId: string, geometry: LngLat | LngLat[]): Facility {
  return { id: shortId(), typeId, geometry };
}

interface FacilityDocument {
  facilities: Facility[];
}

function isPolygon(geometry: LngLat | LngLat[]): geometry is LngLat[] {
  return Array.isArray(geometry[0]);
}

function sameCoord(left: LngLat, right: LngLat): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function sameGeometry(left: LngLat | LngLat[], right: LngLat | LngLat[]): boolean {
  if (left === right) return true;
  if (isPolygon(left) !== isPolygon(right)) return false;
  if (!isPolygon(left) && !isPolygon(right)) return sameCoord(left, right);
  if (!isPolygon(left) || !isPolygon(right) || left.length !== right.length) return false;
  return left.every((point, index) => sameCoord(point, right[index]));
}

function replaceFacility<System extends FacilityDocument>(
  system: System,
  id: string,
  update: (facility: Facility) => Facility,
): System {
  const index = system.facilities.findIndex((facility) => facility.id === id);
  if (index < 0) return system;
  const current = system.facilities[index];
  const facility = update(current);
  if (facility === current) return system;
  const facilities = [...system.facilities];
  facilities[index] = facility;
  return { ...system, facilities };
}

export function moveFacility<System extends FacilityDocument>(
  system: System,
  id: string,
  geometry: LngLat | LngLat[],
): System {
  return replaceFacility(system, id, (facility) =>
    sameGeometry(facility.geometry, geometry) ? facility : { ...facility, geometry },
  );
}

export function setFacilityName<System extends FacilityDocument>(
  system: System,
  id: string,
  name: string,
): System {
  return replaceFacility(system, id, (facility) =>
    facility.name === name ? facility : { ...facility, name },
  );
}
