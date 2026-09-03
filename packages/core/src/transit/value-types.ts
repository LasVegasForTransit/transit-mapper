export type KnownOrUnknown<Value> = { kind: 'known'; value: Value } | { kind: 'unknown' };

/** A geographic coordinate in longitude, latitude order. */
export type LngLat = [longitude: number, latitude: number];

/** The persisted camera state for an authored transit system. */
export interface Viewport {
  center: LngLat;
  zoom: number;
}

/** The side of the carriageway that forward traffic keeps to. */
export type DrivingSide = 'left' | 'right';

/** The week convention used by recurring service calendars. */
export type Weekday =
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export type Applicability<Value> =
  { kind: 'all' } | { kind: 'only'; values: readonly [Value, ...Value[]] } | { kind: 'unknown' };

export type Grade = 'underground' | 'atGrade' | 'elevated';

export type LegDirection = 'forward' | 'reverse';

export type LineGeometry = 'straight' | 'curved' | 'freeform';

export type LegLane = { kind: 'auto' } | { kind: 'pinned'; laneId: string };

export interface LegExtent {
  start: number;
  end: number;
}

export type LaneDirection = 'forward' | 'reverse' | 'both' | 'none';

export interface LaneSpec {
  id: string;
  kindId: string;
  widthMeters: number;
  direction: LaneDirection;
}

export interface CrossSection {
  lanes: readonly LaneSpec[];
}

export interface CurveControl {
  pointIndex: number;
  radiusMeters: number;
}

export type TransitCarrierRef =
  { kind: 'alignment'; id: string } | { kind: 'way'; id: string; laneId?: string };

export function sameTransitCarrier(left: TransitCarrierRef, right: TransitCarrierRef): boolean {
  if (left.kind !== right.kind || left.id !== right.id) return false;
  return left.kind === 'alignment' || right.kind === 'alignment' || left.laneId === right.laneId;
}

export interface PatternDirection {
  key: string;
  label?: string;
}

export interface InstantRange {
  start: string;
  end: string;
}

export type OperationalScope =
  | { kind: 'service-dates'; serviceDates: [string, ...string[]] }
  | { kind: 'absolute'; activePeriods: [InstantRange, ...InstantRange[]] }
  | {
      kind: 'service-dates-and-absolute';
      serviceDates: [string, ...string[]];
      activePeriods: [InstantRange, ...InstantRange[]];
    };

export interface LocalizedAdvisoryText {
  language?: string;
  header?: string;
  description: string;
  url?: string;
}

export interface LineOrderEntry {
  lineId: string;
  rank: number;
}

export type ServiceTimeZone = { kind: 'iana'; value: string } | { kind: 'unknown' };

export type BoardingRule = 'regular' | 'none' | 'request' | 'coordinate' | 'unknown';

export type ServiceDateRange =
  | { kind: 'bounded'; startDate: string; endDate: string }
  | { kind: 'from'; startDate: string }
  | { kind: 'through'; endDate: string }
  | { kind: 'unbounded' };
