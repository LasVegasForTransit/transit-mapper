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
}

/** Replace a document's rolling-stock definitions without timestamp policy. */
export function setVehicleKinds<System extends VehicleKindDocument>(
  system: System,
  kinds: VehicleKind[],
): System {
  return system.vehicleKinds === kinds ? system : { ...system, vehicleKinds: kinds };
}
