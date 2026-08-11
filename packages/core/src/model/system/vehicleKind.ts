import type { Service } from './service';

/** A specific piece of rolling stock/equipment a service can be assigned to
 *  run — lets someone testing a transit system idea choose which vehicle a
 *  line actually uses (a short single-unit LRV vs. a long double-consist
 *  one, say), rather than every service of a mode sharing one fixed size
 *  and speed. Part of the transit system document, like stations/ways/
 *  services — not a hardcoded catalog entry, since these are meant to be
 *  created and tuned by the person planning the system, not a developer. */
export interface VehicleKind {
  id: string;
  /** Mode catalog id this kind is usable for — constrains which services
   *  it can be assigned to. */
  modeId: string;
  /** e.g. "Siemens S700", "40' Standard Bus". */
  label: string;
  widthM: number;
  lengthM: number;
  /** Informational only — nothing in this app simulates ridership/capacity
   *  yet; this is a label for the person planning, not a simulation input. */
  capacityPax?: number;
  /** Drives simulated travel time (apps/web/src/sim/vehicles.ts) — unset
   *  falls back to the app's ambient default speed, same as an unassigned
   *  service today. */
  topSpeedKmh?: number;
  /** How fast this vehicle speeds up from rest, in m/s². Unset falls back to
   *  a plausible default, same as topSpeedKmh. */
  accelMps2?: number;
  /** How fast this vehicle slows to a stop, in m/s². Unset falls back to a
   *  plausible default, same as topSpeedKmh. Usually higher than
   *  accelMps2 — braking is faster than accelerating for most rail and bus
   *  vehicles. */
  decelMps2?: number;
}

interface VehicleKindDocument {
  vehicleKinds: VehicleKind[];
  services: Service[];
}

function vehicleKindsEqual(left: VehicleKind[], right: VehicleKind[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((kind, index) => {
    const other = right[index];
    return (
      kind.id === other.id &&
      kind.modeId === other.modeId &&
      kind.label === other.label &&
      kind.widthM === other.widthM &&
      kind.lengthM === other.lengthM &&
      kind.capacityPax === other.capacityPax &&
      kind.topSpeedKmh === other.topSpeedKmh &&
      kind.accelMps2 === other.accelMps2 &&
      kind.decelMps2 === other.decelMps2
    );
  });
}

function servicesWithCompatibleKinds(services: Service[], kinds: VehicleKind[]): Service[] {
  let changed = false;
  const compatible: Service[] = [];
  for (const service of services) {
    if (!service.vehicleKindId) {
      compatible.push(service);
      continue;
    }
    const kind = kinds.find((candidate) => candidate.id === service.vehicleKindId);
    if (kind?.modeId === service.modeId) {
      compatible.push(service);
      continue;
    }
    // Replacing the catalog cannot leave Services pointing at removed or
    // newly mode-incompatible equipment.
    changed = true;
    const updated = { ...service };
    delete updated.vehicleKindId;
    compatible.push(updated);
  }
  return changed ? compatible : services;
}

/** Replace a document's rolling-stock definitions without timestamp policy. */
export function setVehicleKinds<System extends VehicleKindDocument>(
  system: System,
  kinds: VehicleKind[],
): System {
  const vehicleKinds = vehicleKindsEqual(system.vehicleKinds, kinds) ? system.vehicleKinds : kinds;
  const services = servicesWithCompatibleKinds(system.services, vehicleKinds);
  return vehicleKinds === system.vehicleKinds && services === system.services
    ? system
    : { ...system, vehicleKinds, services };
}
