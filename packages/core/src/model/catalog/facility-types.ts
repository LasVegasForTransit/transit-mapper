import { fromCatalog } from './from-catalog';
// Part of the kind catalog. See ../catalog.ts for what this data is and why
// it is data rather than union types baked into logic.

// ---- Facility types ---------------------------------------------------------
// Catalog-typed point/area features that aren't ways or stops in their own
// right: a bike dock, a stop entrance, a depot/yard. `geometryKind` says
// whether a placed Facility is a single point or an area (polygon) — not to
// be confused with `FacilityClass` above, which refines a WAY's right-of-way
// (arterial vs. local), a different axis entirely.

export type FacilityGeometryKind = 'point' | 'area';

export interface FacilityType {
  id: string;
  label: string;
  geometryKind: FacilityGeometryKind;
  /**
   * Half-width, in meters, of the square an AREA facility is created as when
   * it's click-placed rather than drawn to shape. Null for point kinds, which
   * have no footprint to size.
   *
   * Required rather than optional so adding a facility type forces the
   * question to be answered here, in the catalog, instead of being answered
   * by whatever code happens to place one. Enforced by a check in verify.ts.
   */
  defaultHalfExtentM: number | null;
}

// The click-placed extents below all carry the single 15m half-extent every
// area facility was hardcoded to before these moved into the catalog, so
// placement is unchanged. They are per-type now so they CAN diverge — a
// platform and a depot have no business being the same size — but retuning
// them is a deliberate design pass, not a side effect of relocating them.
const FACILITY_TYPES_BY_ID = {
  entrance: { id: 'entrance', label: 'Entrance', geometryKind: 'point', defaultHalfExtentM: null },
  bikeDock: { id: 'bikeDock', label: 'Bike dock', geometryKind: 'point', defaultHalfExtentM: null },
  elevator: { id: 'elevator', label: 'Elevator', geometryKind: 'point', defaultHalfExtentM: null },
  // A stop building / terminal / headhouse — the general-purpose drawn
  // structure that sits on stop land alongside platforms and bus bays.
  building: { id: 'building', label: 'Building', geometryKind: 'area', defaultHalfExtentM: 15 },
  parkingLot: { id: 'parkingLot', label: 'Parking', geometryKind: 'area', defaultHalfExtentM: 15 },
  depot: { id: 'depot', label: 'Depot / yard', geometryKind: 'area', defaultHalfExtentM: 15 },
  // A bus's curbside stopping bay and a boarding platform (rail/tram/BRT
  // alike) both have a real footprint — placed inside a facility boundary
  // the same way a stop's platforms sit inside its own footprint.
  busBay: { id: 'busBay', label: 'Bus bay', geometryKind: 'area', defaultHalfExtentM: 15 },
  platform: { id: 'platform', label: 'Platform', geometryKind: 'area', defaultHalfExtentM: 15 },
} satisfies Record<string, FacilityType>;

/** Every facility type the catalog defines. See LaneKindId for why. */
export type FacilityTypeId = keyof typeof FACILITY_TYPES_BY_ID;

export const FACILITY_TYPES: Record<string, FacilityType> = FACILITY_TYPES_BY_ID;

export const FACILITY_TYPE_ORDER: string[] = [
  'entrance',
  'bikeDock',
  'elevator',
  'building',
  'busBay',
  'platform',
  'parkingLot',
  'depot',
];

export function facilityType(id: string): FacilityType {
  return fromCatalog(FACILITY_TYPES, id, FACILITY_TYPES.entrance);
}
