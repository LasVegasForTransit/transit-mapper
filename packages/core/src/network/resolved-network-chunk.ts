import type { LngLat } from '../geography/bounds';
import type { GeographicPolygon } from '../geography/coverage';
import type { TransitEntityRef } from '../model/transit-entity-ref';
import type {
  Applicability,
  CrossSection,
  CurveControl,
  Grade,
  KnownOrUnknown,
  LegDirection,
  LineGeometry,
  LocalizedAdvisoryText,
  OperationalScope,
  PatternDirection,
  TransitCarrierRef,
} from '../transit/value-types';

export interface ResolvedLine {
  id: string;
  name?: string;
  publicCode?: string;
  color?: string;
}

export interface ResolvedServicePlan {
  id: string;
  name?: string;
  mode: KnownOrUnknown<string>;
  vehicleKindId?: string;
  activity: 'active' | 'inactive' | 'unknown';
}

export interface ResolvedPattern {
  id: string;
  direction?: PatternDirection;
  path: 'known' | 'unknown';
}

export interface ResolvedStop {
  id: string;
  name?: string;
  location: KnownOrUnknown<LngLat>;
  stationId?: string;
  major: boolean;
}

export interface ResolvedStation {
  id: string;
  name?: string;
  location: KnownOrUnknown<LngLat>;
}

export interface ResolvedAlignment {
  id: string;
}

export interface ResolvedWay {
  id: string;
  alignmentId: string;
  /** Maps the Way's normalized [0, 1] carrier range onto its Alignment. */
  alignmentExtent: readonly [number, number];
  typeId: string;
  grade: Grade;
  profile: CrossSection;
  classId?: string;
}

export interface LineServicePlanLink {
  id: string;
  lineId: string;
  servicePlanId: string;
}

export interface ServicePlanPatternLink {
  id: string;
  servicePlanId: string;
  patternId: string;
}

export interface ResolvedPatternStopCall {
  id: string;
  patternId: string;
  stopId: string;
  sequence: number;
  service: 'served' | 'skipped' | 'unknown';
  pathAnchor?: {
    legIndex: number;
    carrierPosition: number;
  };
}

export interface ResolvedCarrierFragment {
  id: string;
  carrier: TransitCarrierRef;
  alignmentId: string;
  alignmentRange: readonly [number, number];
  /**
   * Centerline evidence for this transferred range in ascending carrier order.
   * Straight and freeform carriers store path vertices. Curved carriers store
   * local control vertices with fragment-local curve controls.
   */
  points: readonly [LngLat, LngLat, ...LngLat[]];
  geometry: LineGeometry;
  curveControls: readonly CurveControl[];
}

export interface ResolvedPatternLegFragment {
  id: string;
  /** Identifies one semantic Pattern-leg piece before query clipping. */
  logicalPatternLegFragmentId: string;
  patternId: string;
  legIndex: number;
  carrierFragmentId: string;
  /** The referenced carrier points cover this exact normalized carrier range. */
  carrierRange: readonly [number, number];
  /** Contains every transferred shard range for this logical piece. */
  logicalCarrierRange: readonly [number, number];
  /** Contains the complete logical piece's normalized range on its Alignment. */
  logicalAlignmentRange: readonly [number, number];
  direction: LegDirection;
}

export interface ResolvedTopologyWindowCall {
  stopCallId: string;
  /** Number of listed Pattern-leg fragments before this call. */
  patternLegBoundaryIndex: number;
}

export interface ResolvedTopologyWindow {
  id: string;
  patternId: string;
  anchoredCalls: readonly [
    ResolvedTopologyWindowCall,
    ResolvedTopologyWindowCall,
    ...ResolvedTopologyWindowCall[],
  ];
  patternLegFragmentIds: readonly [string, ...string[]];
}

export interface ResolvedSourceEvidence {
  sourceIds: readonly [string, ...string[]];
  sourceRevisionIds: readonly [string, ...string[]];
  lastUpdatedAt?: string;
}

export interface ResolvedReplacementLink {
  id: string;
  replacement: TransitEntityRef;
  target: TransitEntityRef;
}

export interface ResolvedAdvisory {
  id: string;
  affected: readonly TransitEntityRef[];
  scope?: OperationalScope;
  cause?: string;
  effect?: string;
  text: readonly LocalizedAdvisoryText[];
  source: ResolvedSourceEvidence;
}

export interface ResolvedOperationalChange {
  id: string;
  kind:
    'shuttle' | 'detour' | 'skipped-stop' | 'cancelled' | 'suspended' | 'schedule-change' | 'other';
  label: string;
  affected: readonly TransitEntityRef[];
  scope: OperationalScope;
  replacements: readonly ResolvedReplacementLink[];
  source: ResolvedSourceEvidence;
}

export interface ResolvedFacility {
  id: string;
  typeId: string;
  name?: string;
  location?: LngLat;
}

export interface ResolvedGroup {
  id: string;
  name?: string;
  color?: string;
}

export interface ResolvedAreaFragment {
  id: string;
  owner: { kind: 'station' | 'facility' | 'group'; id: string };
  polygon: GeographicPolygon;
}

export interface ResolvedGroupMemberLink {
  id: string;
  groupId: string;
  member: TransitEntityRef;
}

export interface ResolvedNode {
  id: string;
  location: KnownOrUnknown<LngLat>;
  wayPoints: readonly { wayId: string; pointIndex: number }[];
  controlId?: string;
}

export interface ResolvedNamedWay {
  id: string;
  name: string;
  wayIds: readonly [string, ...string[]];
}

export interface ResolvedMedian {
  id: string;
  namedWayId: string;
  widthMeters: number;
  kindId: string;
}

export interface ResolvedLaneConnector {
  id: string;
  nodeId: string;
  from: { wayId: string; laneId: string };
  to: { wayId: string; laneId: string };
}

export interface ResolvedTurnRestriction {
  id: string;
  from: { wayId: string; laneIds: Applicability<string> };
  to: { wayId: string; laneIds: Applicability<string> };
  via: { kind: 'node'; nodeId: string } | { kind: 'ways'; wayIds: readonly [string, ...string[]] };
  movement: 'prohibited' | 'only';
  modeIds: Applicability<string>;
}

export interface ResolvedApproachControl {
  id: string;
  nodeId: string;
  wayId: string;
  end: 'start' | 'end';
  controlId: string;
}

export interface ResolvedInfrastructureChunk {
  nodes: readonly ResolvedNode[];
  namedWays: readonly ResolvedNamedWay[];
  medians: readonly ResolvedMedian[];
  laneConnectors: readonly ResolvedLaneConnector[];
  turnRestrictions: readonly ResolvedTurnRestriction[];
  approachControls: readonly ResolvedApproachControl[];
  facilities: readonly ResolvedFacility[];
  groups: readonly ResolvedGroup[];
  groupMembers: readonly ResolvedGroupMemberLink[];
  areas: readonly ResolvedAreaFragment[];
}

export interface ResolvedNetworkChunk {
  id: string;
  entities: {
    lines: readonly ResolvedLine[];
    servicePlans: readonly ResolvedServicePlan[];
    patterns: readonly ResolvedPattern[];
    stops: readonly ResolvedStop[];
    stations: readonly ResolvedStation[];
    alignments: readonly ResolvedAlignment[];
    ways: readonly ResolvedWay[];
  };
  relationships: {
    lineServicePlans: readonly LineServicePlanLink[];
    servicePlanPatterns: readonly ServicePlanPatternLink[];
    patternStopCalls: readonly ResolvedPatternStopCall[];
    topologyWindows: readonly ResolvedTopologyWindow[];
    replacements: readonly ResolvedReplacementLink[];
  };
  geometry: {
    carriers: readonly ResolvedCarrierFragment[];
    patternLegs: readonly ResolvedPatternLegFragment[];
    visiblePatternLegFragmentIds: readonly string[];
  };
  operationalChanges: readonly ResolvedOperationalChange[];
  advisories: readonly ResolvedAdvisory[];
  infrastructure: ResolvedInfrastructureChunk;
}
