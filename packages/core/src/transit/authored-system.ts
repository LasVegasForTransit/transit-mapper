import type { ExternalRef, SourceCitation } from '../source/source-reference';
import type { Attribution, ContentDigest, LicenseRef } from '../source/value-types';
import type { TransitEntityRef } from './entity-ref';
import type {
  BoardingRule,
  CrossSection,
  CurveControl,
  DrivingSide,
  Grade,
  LegDirection,
  LegExtent,
  LegLane,
  LineGeometry,
  LngLat,
  PatternDirection,
  ServiceDateRange,
  ServiceTimeZone,
  Viewport,
  Weekday,
} from './value-types';

/** A physical travel geometry with no implied lane or legal-routing meaning. */
export interface Alignment {
  id: string;
  points: LngLat[];
  geometry: LineGeometry;
  curveControls?: CurveControl[];
}

/** Physical infrastructure that claims one Alignment. */
export interface Way {
  id: string;
  alignmentId: string;
  typeId: string;
  grade: Grade;
  profile: CrossSection;
  classId?: string;
}

interface PatternLegBase {
  direction: LegDirection;
  extent: LegExtent;
}

/** A Pattern follows either abstract geometry or a physical carrier. */
export type PatternLeg =
  | (PatternLegBase & {
      kind: 'alignment';
      alignmentId: string;
    })
  | (PatternLegBase & {
      kind: 'way';
      wayId: string;
      lane: LegLane;
    });

/** Known geometry must not be represented by an empty list. */
export type PatternPath = { kind: 'known'; legs: PatternLeg[] } | { kind: 'unknown' };

export interface PatternStopCall {
  id: string;
  stopId: string;
}

/** A passenger-facing identity. It owns the one Line-to-ServicePlan relation. */
export interface Line {
  id: string;
  name: string;
  color: string;
  servicePlanIds: string[];
}

/** A mode-specific operation beneath a passenger Line. */
export interface ServicePlan {
  id: string;
  name?: string;
  modeId: string;
  vehicleKindId?: string;
  patternIds: string[];
  scheduleIds: string[];
  planningSummary?: ServicePlanningSummary;
}

/** Approximate planning facts that do not claim calendar-level precision. */
export interface ServicePlanningSummary {
  peakHeadwaySeconds?: number;
  spanStartSeconds?: number;
  spanEndSeconds?: number;
}

/** One direction-specific stopping and geometry pattern. */
export interface Pattern {
  id: string;
  direction?: PatternDirection;
  path: PatternPath;
  stopCalls: PatternStopCall[];
}

/** Time facts are separate from geometry and stopping patterns. */
export interface Schedule {
  id: string;
  tripIds: string[];
  frequencyRuleIds: string[];
}

export interface ScheduledStopTime {
  stopCallId: string;
  arrivalSeconds?: number;
  departureSeconds?: number;
  precision: 'exact' | 'estimated' | 'unknown';
  pickup: BoardingRule;
  dropOff: BoardingRule;
}

export interface Trip {
  id: string;
  patternId: string;
  calendarId: string;
  stopTimes: ScheduledStopTime[];
}

export interface FrequencyRule {
  id: string;
  label?: string;
  patternId: string;
  calendarId: string;
  startTimeSeconds: number;
  endTimeSeconds: number;
  headwaySeconds: number;
  precision: 'exact' | 'headway' | 'unknown';
  templateStopTimes: ScheduledStopTime[];
}

export interface Calendar {
  id: string;
  timeZone: ServiceTimeZone;
  dateRange: ServiceDateRange;
  activeWeekdays: Weekday[];
  exceptions: CalendarException[];
}

export interface CalendarException {
  serviceDate: string;
  action: 'add' | 'remove';
}

export interface StopAnchor {
  alignmentId: string;
  t: number;
}

export interface Stop {
  id: string;
  name?: string;
  stationId?: string;
  autoNamed?: boolean;
  coord: LngLat;
  anchors: StopAnchor[];
  dwellSeconds?: number;
  majorStop?: boolean;
}

export interface Platform {
  id: string;
  points: LngLat[];
  edges?: number;
}

export interface Station {
  id: string;
  name?: string;
  coord: LngLat;
  footprint?: LngLat[];
  platforms?: Platform[];
}

export interface Facility {
  id: string;
  typeId: string;
  name?: string;
  geometry: LngLat | LngLat[];
}

export interface Group {
  id: string;
  name?: string;
  memberIds: string[];
  footprint?: LngLat[];
  color?: string;
}

export interface WayPointRef {
  wayId: string;
  pointIndex: number;
}

export interface LaneConnector {
  from: { wayId: string; laneId: string };
  to: { wayId: string; laneId: string };
}

export type NodeControl =
  'uncontrolled' | 'signal' | 'stop' | 'yield' | 'roundabout' | 'levelCrossing';

export interface Node {
  id: string;
  coord: LngLat;
  refs: WayPointRef[];
  control?: NodeControl;
  connectors?: LaneConnector[];
}

export interface NamedWay {
  id: string;
  name: string;
  wayIds: string[];
}

export interface Median {
  widthM: number;
  kindId: string;
}

export interface TurnRestriction {
  allowedTargets: string[];
}

export interface ApproachControl {
  control: NodeControl;
}

export interface VehicleKind {
  id: string;
  modeId: string;
  label: string;
  widthM: number;
  lengthM: number;
  capacityPax?: number;
  topSpeedKmh?: number;
  accelMps2?: number;
  decelMps2?: number;
}

export type ComponentMap<Value> = Record<string, Value>;

export interface SourceBinding {
  external: ExternalRef;
  target: TransitEntityRef;
  lastAppliedRevisionId: string;
  baseline: SourceBindingBaseline;
}

export interface SourceBindingBaseline {
  sourceHash: string;
  targetHash: string;
  schemaVersion: '17';
  normalizerVersion: 'reviewed-import-v1';
}

/** Resolves old Service references without making aliases first-class entities. */
export interface LegacyServiceAlias {
  legacyServiceId: string;
  lineId: string;
  servicePlanId: string;
  patternIds: {
    outbound: string;
    inbound?: string;
  };
}

/** Retains an opaque v16 Way.source marker without granting update authority. */
export interface LegacySourceReference {
  target: Extract<TransitEntityRef, { kind: 'way' }>;
  value: string;
}

export interface ImportHistoryEntry {
  id: string;
  importedAt: string;
  origin:
    | { kind: 'managed-dataset'; datasetRevisionId: string }
    | {
        kind: 'one-time-upload';
        artifactDigest: ContentDigest;
        mediaType: string;
        label?: string;
        attribution?: Attribution;
        license?: LicenseRef;
      };
}

/** The v17 authored document. It contains no host, renderer, or source runtime state. */
export interface TransitSystem {
  version: 17;
  id: string;
  name: string;
  description?: string;
  viewport: Viewport;
  createdAt: number;
  updatedAt: number;
  alignments: Alignment[];
  ways: Way[];
  lines: Line[];
  servicePlans: ServicePlan[];
  patterns: Pattern[];
  schedules: Schedule[];
  calendars: Calendar[];
  trips: Trip[];
  frequencyRules: FrequencyRule[];
  stops: Stop[];
  stations: Station[];
  facilities: Facility[];
  groups: Group[];
  nodes: Node[];
  namedWays: NamedWay[];
  vehicleKinds: VehicleKind[];
  palette: string[];
  drivingSide: DrivingSide;
  turnRestrictions: ComponentMap<TurnRestriction>;
  medians: ComponentMap<Median>;
  approachControls: ComponentMap<ApproachControl>;
  sourceCitations: SourceCitation[];
  sourceBindings: SourceBinding[];
  legacyServiceAliases: LegacyServiceAlias[];
  legacySourceReferences: LegacySourceReference[];
  importHistory: ImportHistoryEntry[];
}
