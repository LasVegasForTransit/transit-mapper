import type { GeographicBounds } from '../../geography/bounds';
import type { DetailBand, ModeSelection } from '../query';
import { detailBandContent } from '../detail-band';
import { clippedCarrierGeometry } from '../carrier-geometry';
import { derivedId as derivedIdentity } from '../../model/derived-id';
import { wayGeometrySource } from './carrier-geometry';
import { derivedId } from '../../model/derived-id';
import type { Pattern, TransitSystem } from '../../transit/authored-system';
import { alignmentIndex } from './carrier-geometry';
import { sameLineCarrierClosure } from './line-closure';
import { projectPatternGeometry } from './pattern-legs';
import { projectPatternStopCalls } from './stop-calls';
import type {
  ResolvedCarrierFragment,
  ResolvedNetworkChunk,
  ResolvedPatternLegFragment,
  ResolvedPatternStopCall,
} from '../resolved-network-chunk';

/** v17 stores no per-Way extent along its Alignment: a Way claims the whole
 * one. Emitting [0, 1] states that rather than inventing a narrower range a
 * consumer would then trust. */
const WHOLE_ALIGNMENT: readonly [number, number] = [0, 1];

function emptyInfrastructure(): ResolvedNetworkChunk['infrastructure'] {
  return {
    nodes: [],
    namedWays: [],
    medians: [],
    laneConnectors: [],
    turnRestrictions: [],
    approachControls: [],
    facilities: [],
    groups: [],
    groupMembers: [],
    areas: [],
  };
}

interface PatternProjection {
  readonly carriers: readonly ResolvedCarrierFragment[];
  readonly patternLegs: readonly ResolvedPatternLegFragment[];
  readonly stopCalls: readonly ResolvedPatternStopCall[];
}

function projectPatterns(
  patterns: readonly Pattern[],
  system: TransitSystem,
  bounds: GeographicBounds,
): PatternProjection {
  const alignments = alignmentIndex(system);
  const carriers: ResolvedCarrierFragment[] = [];
  const patternLegs: ResolvedPatternLegFragment[] = [];
  const stopCalls: ResolvedPatternStopCall[] = [];
  for (const pattern of patterns) {
    const geometry = projectPatternGeometry(pattern, { system, bounds }, alignments);
    carriers.push(...geometry.carriers);
    patternLegs.push(...geometry.patternLegs);
    stopCalls.push(...projectPatternStopCalls(pattern, system));
  }
  return { carriers, patternLegs, stopCalls };
}

export interface ChunkOptions {
  readonly system: TransitSystem;
  readonly bounds: GeographicBounds;
  readonly modes: ModeSelection;
  readonly detailBand: DetailBand;
  readonly chunkId: string;
}

/** The street network as a thing in its own right: Ways in the bounds that
 * carry no selected Pattern. A default road corridor is under two displayed
 * pixels at overview, so none of it is drawable there, and a region-wide
 * viewport is exactly where there is most of it. Ways that do carry a Pattern
 * arrive through the closure at every band. */
function streetNetworkCarriers(
  system: TransitSystem,
  bounds: GeographicBounds,
  carriedAlignmentIds: ReadonlySet<string>,
): readonly ResolvedCarrierFragment[] {
  const alignments = alignmentIndex(system);
  const carriers: ResolvedCarrierFragment[] = [];
  for (const way of system.ways) {
    if (carriedAlignmentIds.has(way.alignmentId)) continue;
    const source = wayGeometrySource(way, alignments);
    if (!source) continue;
    for (const piece of clippedCarrierGeometry(source, [0, 1], bounds, (role, range) =>
      derivedIdentity('v17', `${role}-street-carrier`, way.id, String(range[0]), String(range[1])),
    )) {
      carriers.push(piece.carrier);
    }
  }
  return carriers;
}

/** Applied before the closure rather than after it. A ServicePlan running an
 * excluded mode must not seed a carrier, or excluding a mode would still drag
 * that mode's geometry into the page through a Line it shares. */
function servicePlanFilter(
  system: TransitSystem,
  modes: ModeSelection,
): (servicePlanId: string) => boolean {
  if (modes.kind === 'all') return () => true;
  const selected = new Set(modes.ids);
  const allowed = new Set(
    system.servicePlans.filter((plan) => selected.has(plan.modeId)).map(({ id }) => id),
  );
  return (servicePlanId) => allowed.has(servicePlanId);
}

/**
 * Assembles one bounded page of a v17 System.
 *
 * The emitted Patterns are the closure's, not the viewport's: a Line already
 * on screen needs every leg it has on the carriers it occupies, or its offset
 * would move with the camera. `visiblePatternLegFragmentIds` still names only
 * what the viewport revealed, because that set alone authorizes paint and a
 * closure leg is context rather than something to draw.
 */
interface IncludedScope {
  readonly patterns: readonly Pattern[];
  readonly servicePlans: TransitSystem['servicePlans'];
  readonly lines: TransitSystem['lines'];
}

/** A Pattern is included when the closure names it, and a plan or Line is
 * included when it owns something included. Selecting the other way round —
 * Lines first — would emit plans whose Patterns this page never carries. */
function includedScope(system: TransitSystem, patternIds: ReadonlySet<string>): IncludedScope {
  const patterns = system.patterns.filter((pattern) => patternIds.has(pattern.id));
  const included = new Set(patterns.map(({ id }) => id));
  const servicePlans = system.servicePlans.filter((plan) =>
    plan.patternIds.some((patternId) => included.has(patternId)),
  );
  const planIds = new Set(servicePlans.map(({ id }) => id));
  const lines = system.lines.filter((line) =>
    line.servicePlanIds.some((planId) => planIds.has(planId)),
  );
  return { patterns, servicePlans, lines };
}

function projectEntities(
  system: TransitSystem,
  scope: IncludedScope,
  stopCalls: readonly ResolvedPatternStopCall[],
  carriers: readonly ResolvedCarrierFragment[],
): ResolvedNetworkChunk['entities'] {
  const stopIds = new Set(stopCalls.map((call) => call.stopId));
  const stops = system.stops.filter((stop) => stopIds.has(stop.id));
  const stationIds = new Set(
    stops.map((stop) => stop.stationId).filter((id): id is string => id !== undefined),
  );
  const alignmentIds = new Set(carriers.map((carrier) => carrier.alignmentId));
  return {
    lines: scope.lines.map((line) => ({ id: line.id, name: line.name, color: line.color })),
    servicePlans: scope.servicePlans.map((plan) => ({
      id: plan.id,
      ...(plan.name === undefined ? {} : { name: plan.name }),
      mode: { kind: 'known' as const, value: plan.modeId },
      ...(plan.vehicleKindId === undefined ? {} : { vehicleKindId: plan.vehicleKindId }),
      // A ServicePlan states no activity of its own; only a Calendar can, and
      // that lives behind a service instant this chunk was not given.
      activity: 'unknown' as const,
    })),
    patterns: scope.patterns.map((pattern) => ({
      id: pattern.id,
      ...(pattern.direction === undefined ? {} : { direction: pattern.direction }),
      path: pattern.path.kind,
    })),
    stops: stops.map((stop) => ({
      id: stop.id,
      ...(stop.name === undefined ? {} : { name: stop.name }),
      location: { kind: 'known' as const, value: stop.coord },
      ...(stop.stationId === undefined ? {} : { stationId: stop.stationId }),
      major: stop.majorStop ?? false,
    })),
    stations: system.stations
      .filter((station) => stationIds.has(station.id))
      .map((station) => ({
        id: station.id,
        ...(station.name === undefined ? {} : { name: station.name }),
        location: { kind: 'known' as const, value: station.coord },
      })),
    alignments: system.alignments
      .filter((alignment) => alignmentIds.has(alignment.id))
      .map((alignment) => ({ id: alignment.id })),
    ways: system.ways
      .filter((way) => alignmentIds.has(way.alignmentId))
      .map((way) => ({
        id: way.id,
        alignmentId: way.alignmentId,
        alignmentExtent: WHOLE_ALIGNMENT,
        typeId: way.typeId,
        grade: way.grade,
        profile: way.profile,
        ...(way.classId === undefined ? {} : { classId: way.classId }),
      })),
  };
}

function projectRelationships(
  scope: IncludedScope,
  stopCalls: readonly ResolvedPatternStopCall[],
): ResolvedNetworkChunk['relationships'] {
  const planIds = new Set(scope.servicePlans.map(({ id }) => id));
  const patternIds = new Set(scope.patterns.map(({ id }) => id));
  return {
    lineServicePlans: scope.lines.flatMap((line) =>
      line.servicePlanIds
        .filter((planId) => planIds.has(planId))
        .map((servicePlanId) => ({
          id: derivedId('v17', 'line-service-plan', line.id, servicePlanId),
          lineId: line.id,
          servicePlanId,
        })),
    ),
    servicePlanPatterns: scope.servicePlans.flatMap((plan) =>
      plan.patternIds
        .filter((patternId) => patternIds.has(patternId))
        .map((patternId) => ({
          id: derivedId('v17', 'service-plan-pattern', plan.id, patternId),
          servicePlanId: plan.id,
          patternId,
        })),
    ),
    patternStopCalls: stopCalls,
    topologyWindows: [],
    replacements: [],
  };
}

/**
 * Assembles one bounded page of a v17 System.
 *
 * The emitted Patterns are the closure's, not the viewport's: a Line already
 * on screen needs every leg it has on the carriers it occupies, or its offset
 * would move with the camera. `visiblePatternLegFragmentIds` still names only
 * what the viewport revealed, because that set alone authorizes paint and a
 * closure leg is context rather than something to draw.
 */
export function mapChunk({
  system,
  bounds,
  modes,
  detailBand,
  chunkId,
}: ChunkOptions): ResolvedNetworkChunk {
  const closure = sameLineCarrierClosure(system, bounds, servicePlanFilter(system, modes));
  const scope = includedScope(system, closure.patternIds);
  const projected = projectPatterns(scope.patterns, system, bounds);
  const carriedAlignmentIds = new Set(projected.carriers.map((carrier) => carrier.alignmentId));
  const street = detailBandContent(detailBand).streetNetwork
    ? streetNetworkCarriers(system, bounds, carriedAlignmentIds)
    : [];
  const carriers = [...projected.carriers, ...street];
  return {
    id: chunkId,
    entities: projectEntities(system, scope, projected.stopCalls, carriers),
    relationships: projectRelationships(scope, projected.stopCalls),
    geometry: {
      carriers,
      patternLegs: projected.patternLegs,
      visiblePatternLegFragmentIds: projected.patternLegs
        .filter((leg) => closure.visibleLogicalFragmentIds.has(leg.logicalPatternLegFragmentId))
        .map((leg) => leg.id),
    },
    operationalChanges: [],
    advisories: [],
    infrastructure: emptyInfrastructure(),
  };
}
