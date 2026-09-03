import type { GeographicBounds } from '../../geography/bounds';
import type { Pattern, TransitSystem } from '../../transit/authored-system';
import type { TransitCarrierRef } from '../../transit/value-types';
import { alignmentIndex, type AlignmentIndex } from './carrier-geometry';
import { projectPatternGeometry } from './pattern-legs';

/** Encodes the carrier identity `sameTransitCarrier` compares, so a lane-pinned
 * Way and the same Way taken automatically stay distinct keys. */
function carrierKey(carrier: TransitCarrierRef): string {
  return carrier.kind === 'alignment'
    ? `alignment:${carrier.id}`
    : `way:${carrier.id}:${carrier.laneId ?? ''}`;
}

interface LinePatterns {
  readonly lineId: string;
  readonly patterns: readonly Pattern[];
}

/** A Line reaches its Patterns through its ServicePlans, and two Lines can name
 * the same plan, so a Pattern can belong to more than one Line. */
function patternsByLine(
  system: TransitSystem,
  includePlan: (servicePlanId: string) => boolean,
): readonly LinePatterns[] {
  const planById = new Map(system.servicePlans.map((plan) => [plan.id, plan]));
  const patternById = new Map(system.patterns.map((pattern) => [pattern.id, pattern]));
  return system.lines.map((line) => {
    const patterns: Pattern[] = [];
    const seen = new Set<string>();
    for (const servicePlanId of line.servicePlanIds) {
      if (!includePlan(servicePlanId)) continue;
      for (const patternId of planById.get(servicePlanId)?.patternIds ?? []) {
        if (seen.has(patternId)) continue;
        seen.add(patternId);
        const pattern = patternById.get(patternId);
        if (pattern) patterns.push(pattern);
      }
    }
    return { lineId: line.id, patterns };
  });
}

export interface SameLineCarrierClosure {
  /** Leg fragments the viewport itself reveals, keyed by logical identity. */
  readonly visibleLogicalFragmentIds: ReadonlySet<string>;
  /** Leg fragments a visible Line needs on a carrier it already occupies,
   * including ones the viewport does not reach. */
  readonly closureLogicalFragmentIds: ReadonlySet<string>;
  /** Patterns any of the above belongs to. */
  readonly patternIds: ReadonlySet<string>;
}

/**
 * Completes each visible `(Line, carrier)` seed with the rest of that Line's
 * legs on the same carrier.
 *
 * A Line that shares a carrier with others is drawn at an offset decided by
 * how many Lines run there and in what order. Resolving only the legs a
 * viewport happens to touch would make that offset depend on the camera, so a
 * Line would visibly shift when a pan brought one more of its own legs into
 * view. The closure is per carrier rather than per Line so a distant, unrelated
 * branch of the same Line is not dragged in.
 */
interface LineLegIndex {
  readonly seedCarriers: ReadonlySet<string>;
  readonly legsByCarrier: ReadonlyMap<string, readonly LegEntry[]>;
  readonly visible: readonly LegEntry[];
}

interface LegEntry {
  readonly logicalId: string;
  readonly patternId: string;
}

const WORLD_BOUNDS: GeographicBounds = {
  kind: 'ordinary',
  west: -180,
  south: -90,
  east: 180,
  north: 90,
};

/** Every leg of one Line grouped by the carrier it runs on, alongside the
 * carriers the viewport actually revealed. Projecting twice — once unbounded,
 * once to the query — is what separates "this Line is here" from "this is all
 * of it here". */
function indexLineLegs(
  patterns: readonly Pattern[],
  system: TransitSystem,
  bounds: GeographicBounds,
  alignments: AlignmentIndex,
): LineLegIndex {
  const seedCarriers = new Set<string>();
  const legsByCarrier = new Map<string, LegEntry[]>();
  const visible: LegEntry[] = [];
  for (const pattern of patterns) {
    const everywhere = projectPatternGeometry(
      pattern,
      { system, bounds: WORLD_BOUNDS },
      alignments,
    );
    const inView = projectPatternGeometry(pattern, { system, bounds }, alignments);
    const visibleLogical = new Set(
      inView.patternLegs.map((leg) => leg.logicalPatternLegFragmentId),
    );
    const carrierById = new Map(everywhere.carriers.map((carrier) => [carrier.id, carrier]));
    for (const leg of everywhere.patternLegs) {
      const carrier = carrierById.get(leg.carrierFragmentId);
      if (!carrier) continue;
      const entry: LegEntry = {
        logicalId: leg.logicalPatternLegFragmentId,
        patternId: leg.patternId,
      };
      const key = carrierKey(carrier.carrier);
      legsByCarrier.set(key, [...(legsByCarrier.get(key) ?? []), entry]);
      if (!visibleLogical.has(entry.logicalId)) continue;
      seedCarriers.add(key);
      visible.push(entry);
    }
  }
  return { seedCarriers, legsByCarrier, visible };
}

/**
 * Completes each visible `(Line, carrier)` seed with the rest of that Line's
 * legs on the same carrier.
 *
 * A Line sharing a carrier is drawn at an offset decided by how many Lines run
 * there and in what order. Resolving only the legs a viewport happens to touch
 * would make that offset depend on the camera, so a Line would visibly shift
 * when a pan brought one more of its own legs into view. The closure is per
 * carrier rather than per Line, so a distant unrelated branch of the same Line
 * is not dragged in with it.
 */
export function sameLineCarrierClosure(
  system: TransitSystem,
  bounds: GeographicBounds,
  includeServicePlan: (servicePlanId: string) => boolean = () => true,
  alignments: AlignmentIndex = alignmentIndex(system),
): SameLineCarrierClosure {
  const visibleLogicalFragmentIds = new Set<string>();
  const closureLogicalFragmentIds = new Set<string>();
  const patternIds = new Set<string>();
  const indexes = patternsByLine(system, includeServicePlan).map(({ patterns }) =>
    indexLineLegs(patterns, system, bounds, alignments),
  );
  for (const index of indexes) {
    for (const entry of index.visible) {
      visibleLogicalFragmentIds.add(entry.logicalId);
      patternIds.add(entry.patternId);
    }
  }
  for (const index of indexes) {
    for (const key of index.seedCarriers) {
      for (const entry of index.legsByCarrier.get(key) ?? []) {
        if (visibleLogicalFragmentIds.has(entry.logicalId)) continue;
        closureLogicalFragmentIds.add(entry.logicalId);
        patternIds.add(entry.patternId);
      }
    }
  }
  return { visibleLogicalFragmentIds, closureLogicalFragmentIds, patternIds };
}
