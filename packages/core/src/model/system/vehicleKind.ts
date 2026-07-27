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
}
