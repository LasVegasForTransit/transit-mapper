import { shortId } from './ids';
import { LINE_COLORS, laneKind } from './catalog';
import { deriveLegDirections, oneSection, wayById } from './geo';
import { wayTypeIndex, withSingleTypeArms } from './junctions';
import { mapSectionLegs, pruneSections } from './patternEdits';
import { validateLineServiceMembership } from './line-service';
import { defaultProfileFor } from './profile';
import type { ComponentMap } from './components';
import {
  DEFAULT_VIEWPORT,
  type ApproachControl,
  type CrossSection,
  type DrivingSide,
  type LaneConnector,
  type LaneSpec,
  type Line,
  type Facility,
  type Group,
  type LngLat,
  type Median,
  type NamedWay,
  type Node,
  type NodeControl,
  type Pattern,
  type LegDirection,
  type PatternSection,
  type RunDirection,
  type StationAnchor,
  type LegExtent,
  type LegLane,
  type PatternLeg,
  type ScheduleDayScope,
  type SchedulePeriod,
  type Service,
  type Station,
  type TransitSystem,
  type TurnRestriction,
  type VehicleKind,
  type Way,
  type WayPointRef,
} from './system';

export function createEmptySystem(now = Date.now()): TransitSystem {
  return {
    version: 15,
    id: shortId(),
    name: 'Untitled system',
    viewport: { ...DEFAULT_VIEWPORT },
    createdAt: now,
    updatedAt: now,
    ways: [],
    lines: [],
    services: [],
    stations: [],
    facilities: [],
    groups: [],
    nodes: [],
    namedWays: [],
    vehicleKinds: [],
    palette: [...LINE_COLORS],
    drivingSide: 'right',
    turnRestrictions: {},
    medians: {},
    approachControls: {},
  };
}

/**
 * Finiteness is not enough — a coordinate also has to be on Earth.
 *
 * This is hygiene, NOT a denial-of-service mitigation, and it is worth being
 * precise about that because an earlier version of this comment claimed
 * otherwise. The spatial grids in `geo/snapIndex.ts` and `validate.ts` cost
 * one Map insert per cell a segment's bounding box spans, and that cost is
 * driven by how far apart two points are — which range-checking barely
 * constrains. A way from [-180,-90] to [180,90] is entirely in range and asks
 * the snap grid for ~7.2 billion cells. Measured before it was fixed: ±5°
 * froze for 4.2 seconds, ±10° crashed on V8's Map size limit.
 *
 * The amplification is in the expansion, so the bound lives there too — see
 * MAX_GRID_CELLS in geo/snapIndex.ts and MAX_CROSS_GRID_CELLS in validate.ts.
 * What this check does is keep nonsense out of the model.
 *
 * Longitude is wrapped rather than dropped, because MapLibre hands back
 * unwrapped values like 184 once the user pans into an adjacent world copy,
 * and dropping a point mid-array silently deletes an interior vertex and
 * changes the shape of the way.
 *
 * Known limitation, stated rather than papered over: wrapping happens here,
 * on parse, and nothing wraps coordinates as they arrive from the map. A way
 * drawn ACROSS the antimeridian (178° to 184°) is held in memory as drawn and
 * renders correctly, but reloads as 178° to -176° — the same two places, now
 * joined the long way round. Fixing it properly means normalizing at input
 * and splitting segments at the meridian, which is a real piece of work and
 * not one Las Vegas needs. The bounds above keep such a segment cheap; they
 * do not make it draw correctly.
 */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Validates and normalizes a coordinate, or null if it isn't one. Longitude
 *  is cyclic, so out-of-range names a real place by another number and gets
 *  wrapped; latitude has no such meaning — past a pole is nonsense, not a
 *  lap — so it is rejected. See the note above wrapLng for why this is not
 *  the denial-of-service fix it might look like. */
function normalizedLngLat(v: unknown): LngLat | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [lng, lat] = v;
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90) return null;
  return [wrapLng(lng), lat];
}

function coords(v: unknown): LngLat[] {
  if (!Array.isArray(v)) return [];
  const out: LngLat[] = [];
  for (const item of v) {
    const point = normalizedLngLat(item);
    if (point) out.push(point);
  }
  return out;
}

const GEOMETRIES = new Set(['straight', 'curved', 'freeform']);
const GRADES = new Set(['underground', 'atGrade', 'elevated']);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const geometryOf = (v: unknown) =>
  (typeof v === 'string' && GEOMETRIES.has(v) ? v : 'straight') as Way['geometry'];
const gradeOf = (v: unknown) =>
  (typeof v === 'string' && GRADES.has(v) ? v : 'atGrade') as Way['grade'];

// v2 had one flat "corridor" concept with no way-type distinction; the way
// type a migrated corridor gets is inferred from the mode of a service riding
// it (heavy rail vs. light rail vs. monorail are separate, incompatible way
// types in v3 — see model/catalog.ts). Falls back to "lightRail" when no
// service (or an unrecognized mode) claims the corridor.
const LEGACY_MODE_WAY_TYPE: Record<string, string> = {
  subway: 'heavyRail',
  commuterRail: 'heavyRail',
  lightRail: 'lightRail',
  tram: 'lightRail',
  monorail: 'monorail',
  brt: 'road',
  bus: 'road',
};

/**
 * Validate untrusted input into a TransitSystem, migrating older shapes:
 *  - v3 stores ways (unified infrastructure) and services (colored routes);
 *  - v2 stored corridors (rail-only, mode-agnostic) and roads separately —
 *    each corridor becomes a heavyRail/lightRail/monorail way inferred from
 *    a riding service's mode, each road becomes a "road" way (class
 *    preserved), and each service's corridorIds becomes wayIds;
 *  - v1 stored `lines` (alignment + color together) — each becomes one way
 *    (typed from its own mode) plus one service running over it.
 */
export function parseSystem(input: unknown): TransitSystem {
  if (!input || typeof input !== 'object') throw new Error('System is not an object');
  const o = input as Record<string, unknown>;

  const system =
    Array.isArray(o.ways) || (typeof o.version === 'number' && o.version >= 3)
      ? parseV3(o)
      : migrateFromV2(o);
  const membershipIssues = validateLineServiceMembership(system);
  if (membershipIssues.length > 0) {
    throw new Error(`Invalid Line/Service membership: ${membershipIssues[0].kind}`);
  }
  return system;
}

const LANE_DIRECTIONS = new Set(['forward', 'backward', 'both', 'none']);
const NODE_CONTROLS = new Set(['uncontrolled', 'signal', 'stop', 'roundabout', 'levelCrossing']);

/** Parse a stored cross-section (v6+); null when absent/invalid so the
 *  caller can fall back to a capacity-derived default profile. Unknown lane
 *  kinds are kept only if they parse structurally — laneKind() tolerates
 *  unknown ids at render time. */
function parseProfile(raw: unknown): CrossSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const lanesRaw = (raw as Record<string, unknown>).lanes;
  if (!Array.isArray(lanesRaw)) return null;
  const lanes: LaneSpec[] = [];
  for (const l of lanesRaw) {
    const r = l as Record<string, unknown>;
    if (typeof r.kindId !== 'string') continue;
    const widthM =
      typeof r.widthM === 'number' && Number.isFinite(r.widthM) && r.widthM > 0
        ? r.widthM
        : laneKind(r.kindId).defaultWidthM;
    lanes.push({
      id: typeof r.id === 'string' ? r.id : shortId(),
      kindId: r.kindId,
      widthM,
      direction: (typeof r.direction === 'string' && LANE_DIRECTIONS.has(r.direction)
        ? r.direction
        : 'both') as LaneSpec['direction'],
    });
  }
  return lanes.length > 0 ? { lanes } : null;
}

// Coordinates are compared to this many decimal places (~0.11m at the
// equator) when deriving junctions from raw coincidence — matches the
// precision snap()/joinWayPointToWay actually produce, so two points meant to
// be the same junction always land in the same bucket.
const NODE_COORD_PRECISION = 6;

function coordKey(c: LngLat): string {
  return `${c[0].toFixed(NODE_COORD_PRECISION)},${c[1].toFixed(NODE_COORD_PRECISION)}`;
}

/** A v3 system (or any system saved without an explicit `nodes` field) has no
 *  junction records — derive them from raw coordinate coincidence across
 *  every way's control points. Anything shared by 2+ control points becomes a
 *  Node. */
function deriveNodesFromWays(ways: Way[]): Node[] {
  const groups = new Map<string, { coord: LngLat; refs: WayPointRef[] }>();
  for (const w of ways) {
    w.points.forEach((p, i) => {
      const key = coordKey(p);
      const g = groups.get(key) ?? { coord: p, refs: [] };
      g.refs.push({ wayId: w.id, pointIndex: i });
      groups.set(key, g);
    });
  }
  const nodes: Node[] = [];
  for (const g of groups.values()) {
    if (g.refs.length < 2) continue;
    nodes.push({ id: shortId(), coord: g.coord, refs: g.refs });
  }
  return nodes;
}

/** Validate persisted nodes (v4+) against the ways actually loaded — drops
 *  refs pointing at a missing way or an out-of-range point index, and drops
 *  any node left with fewer than 2 valid refs (no longer a real junction). */
function parseNodes(raw: unknown[], ways: Way[]): Node[] {
  const wayPointCounts = new Map(ways.map((w) => [w.id, w.points.length]));
  const nodes: Node[] = [];
  for (const n of raw) {
    const r = n as Record<string, unknown>;
    const nodeCoord = normalizedLngLat(r.coord);
    if (typeof r.id !== 'string' || !nodeCoord || !Array.isArray(r.refs)) continue;
    const refs: WayPointRef[] = (r.refs as unknown[])
      .map((ref) => ref as Record<string, unknown>)
      .filter((ref) => typeof ref.wayId === 'string' && typeof ref.pointIndex === 'number')
      .map((ref) => ({ wayId: ref.wayId as string, pointIndex: ref.pointIndex as number }))
      .filter((ref) => {
        const count = wayPointCounts.get(ref.wayId);
        return count !== undefined && ref.pointIndex >= 0 && ref.pointIndex < count;
      });
    if (refs.length < 2) continue;
    const control =
      typeof r.control === 'string' && NODE_CONTROLS.has(r.control)
        ? (r.control as NodeControl)
        : undefined;
    const connectors = parseConnectors(r.connectors, ways, refs);
    nodes.push({
      id: r.id,
      coord: nodeCoord,
      refs,
      ...(control ? { control } : {}),
      ...(connectors ? { connectors } : {}),
    });
  }
  return nodes;
}

/** Validate stored lane connectors (v6+): each endpoint must name a way that
 *  is part of this junction and a lane present in that way's profile. Returns
 *  undefined when nothing valid remains (junction reverts to heuristic
 *  connectors). */
function parseConnectors(
  raw: unknown,
  ways: Way[],
  refs: WayPointRef[],
): LaneConnector[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const junctionWayIds = new Set(refs.map((ref) => ref.wayId));
  const laneIdsByWay = new Map(ways.map((w) => [w.id, new Set(w.profile.lanes.map((l) => l.id))]));
  const validEnd = (v: unknown): v is { wayId: string; laneId: string } => {
    const e = v as Record<string, unknown> | undefined;
    return (
      typeof e?.wayId === 'string' &&
      typeof e.laneId === 'string' &&
      junctionWayIds.has(e.wayId) &&
      (laneIdsByWay.get(e.wayId)?.has(e.laneId) ?? false)
    );
  };
  const connectors: LaneConnector[] = [];
  for (const c of raw) {
    const r = c as Record<string, unknown>;
    if (validEnd(r.from) && validEnd(r.to)) {
      connectors.push({
        from: {
          wayId: (r.from as { wayId: string; laneId: string }).wayId,
          laneId: (r.from as { wayId: string; laneId: string }).laneId,
        },
        to: {
          wayId: (r.to as { wayId: string; laneId: string }).wayId,
          laneId: (r.to as { wayId: string; laneId: string }).laneId,
        },
      });
    }
  }
  return connectors.length > 0 ? connectors : undefined;
}

const DRIVING_SIDES = new Set(['left', 'right']);
const drivingSideOf = (v: unknown): DrivingSide =>
  typeof v === 'string' && DRIVING_SIDES.has(v) ? (v as DrivingSide) : 'right';

/** Validate stored per-lane turn restrictions (v8+) — drops entries whose
 *  key doesn't name a lane that still exists, and any listed target that no
 *  longer exists. Malformed keys/entries are dropped rather than defaulted;
 *  a restriction the parser can't trust is worse than a missing one. */
function parseTurnRestrictions(raw: unknown, ways: Way[]): ComponentMap<TurnRestriction> {
  if (!raw || typeof raw !== 'object') return {};
  const wayIds = new Set(ways.map((w) => w.id));
  const laneIdsByWay = new Map(ways.map((w) => [w.id, new Set(w.profile.lanes.map((l) => l.id))]));
  const out: ComponentMap<TurnRestriction> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const sep = key.indexOf(':');
    if (sep < 0) continue;
    const wayId = key.slice(0, sep);
    const laneId = key.slice(sep + 1);
    if (!laneIdsByWay.get(wayId)?.has(laneId)) continue;
    const r = v as Record<string, unknown>;
    out[key] = { allowedTargets: strings(r.allowedTargets).filter((id) => wayIds.has(id)) };
  }
  return out;
}

/** Validate stored medians (v8+) — drops entries whose NamedWay no longer
 *  exists or whose shape is invalid. */
function parseMedians(raw: unknown, namedWays: NamedWay[]): ComponentMap<Median> {
  if (!raw || typeof raw !== 'object') return {};
  const ids = new Set(namedWays.map((n) => n.id));
  const out: ComponentMap<Median> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids.has(key)) continue;
    const r = v as Record<string, unknown>;
    if (typeof r.widthM !== 'number' || !Number.isFinite(r.widthM) || r.widthM <= 0) continue;
    if (typeof r.kindId !== 'string') continue;
    out[key] = { widthM: r.widthM, kindId: r.kindId };
  }
  return out;
}

/** Validate stored per-approach control overrides (v8+) — drops entries
 *  whose way no longer exists or whose control value isn't recognized. */
function parseApproachControls(raw: unknown, ways: Way[]): ComponentMap<ApproachControl> {
  if (!raw || typeof raw !== 'object') return {};
  const wayIds = new Set(ways.map((w) => w.id));
  const out: ComponentMap<ApproachControl> = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const sep = key.lastIndexOf(':');
    if (sep < 0) continue;
    const wayId = key.slice(0, sep);
    const end = key.slice(sep + 1);
    if (!wayIds.has(wayId) || (end !== 'start' && end !== 'end')) continue;
    const r = v as Record<string, unknown>;
    if (typeof r.control !== 'string' || !NODE_CONTROLS.has(r.control)) continue;
    out[key] = { control: r.control as NodeControl };
  }
  return out;
}

/** Validate stored named ways (v6+) — drops references to missing ways and
 *  identities left with no members. */
function parseNamedWays(raw: unknown, ways: Way[]): NamedWay[] {
  if (!Array.isArray(raw)) return [];
  const wayIds = new Set(ways.map((w) => w.id));
  const named: NamedWay[] = [];
  for (const n of raw) {
    const r = n as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string') continue;
    const memberIds = strings(r.wayIds).filter((id) => wayIds.has(id));
    if (memberIds.length > 0) named.push({ id: r.id, name: r.name, wayIds: memberIds });
  }
  return named;
}

function parseVehicleKinds(raw: unknown): VehicleKind[] {
  if (!Array.isArray(raw)) return [];
  const out: VehicleKind[] = [];
  for (const v of raw) {
    const r = v as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.modeId !== 'string' || typeof r.label !== 'string')
      continue;
    if (typeof r.widthM !== 'number' || typeof r.lengthM !== 'number') continue;
    out.push({
      id: r.id,
      modeId: r.modeId,
      label: r.label,
      widthM: r.widthM,
      lengthM: r.lengthM,
      capacityPax: typeof r.capacityPax === 'number' ? r.capacityPax : undefined,
      topSpeedKmh: typeof r.topSpeedKmh === 'number' ? r.topSpeedKmh : undefined,
      accelMps2: typeof r.accelMps2 === 'number' ? r.accelMps2 : undefined,
      decelMps2: typeof r.decelMps2 === 'number' ? r.decelMps2 : undefined,
    });
  }
  return out;
}

/** v5 stores a service's own `patterns` array (one path per branch); pre-v5
 *  systems stored a single flat `wayIds` directly on the service — that
 *  becomes its one pattern. A service with genuinely nothing (empty/missing
 *  both) parses to `patterns: []`, same "ghost record" shape a pre-v5
 *  `wayIds: []` service was — validateSystem flags it, parsing doesn't drop it. */
/** A v9 pattern's optional per-way lane assignment (wayId → LaneSpec.id). Kept
 *  only for ways actually in this pattern, and only string values — unknown
 *  or ill-typed entries are dropped. v10 moved the pin onto the leg, so this
 *  reads the old shape only. */
function parseLaneMap(raw: unknown, wayIds: string[]): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const allowed = new Set(wayIds);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && allowed.has(k)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A leg whose direction isn't known yet. v9 and earlier stored no direction
 *  at all, so a migrated leg leaves `direction` unset and `finish` derives it
 *  from the parsed ways — which only exist once the whole document is
 *  assembled, hence the two-step. */
type DraftLeg = Omit<PatternLeg, 'direction'> & { direction?: LegDirection };
interface DraftPattern {
  id: string;
  legs: DraftLeg[];
  /** Set for a v12+ document, whose sections already say everything — nothing
   *  is left for finish() to derive. */
  sections?: PatternSection[];
  skippedStops?: Partial<Record<RunDirection, string[]>>;
  name?: string;
}

/** A normalized arc position, or undefined when the value is absent or not a
 *  usable number. Out-of-range values clamp rather than reject: a document
 *  that says 1.4 means "the end of the way", not "unparseable". */
function normalizedT(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return Math.max(0, Math.min(1, raw));
}

/** A leg with nothing said about how much of its way it covers or which lane
 *  it rides — every leg in a document written before extents existed. */
function draftWholeLeg(wayId: string): DraftLeg {
  return { wayId, extent: { kind: 'whole' }, lane: { kind: 'auto' } };
}

/** v11 names the direction; v10 stored a `forward` boolean; anything older
 *  stored nothing and leaves this absent for finish() to derive. */
function parseLegDirection(r: Record<string, unknown>): { direction?: LegDirection } {
  if (r.direction === 'withPoints' || r.direction === 'againstPoints')
    return { direction: r.direction };
  if (typeof r.forward === 'boolean')
    return { direction: r.forward ? 'withPoints' : 'againstPoints' };
  return {};
}

/** v11 stores the extent as a tagged value; v10 stored a `fromT`/`toT` pair
 *  that was absent when the leg covered everything. A v10 leg carrying only
 *  one of the two was expressible and meant nothing — it reads as whole. */
function parseLegExtent(r: Record<string, unknown>): LegExtent {
  const raw = r.extent as Record<string, unknown> | undefined;
  if (raw?.kind === 'whole') return { kind: 'whole' };
  const fromT = normalizedT(raw?.kind === 'stretch' ? raw.fromT : r.fromT);
  const toT = normalizedT(raw?.kind === 'stretch' ? raw.toT : r.toT);
  if (fromT === undefined || toT === undefined) return { kind: 'whole' };
  return fromT <= 0 && toT >= 1 ? { kind: 'whole' } : { kind: 'stretch', fromT, toT };
}

/** v11 stores the lane as a tagged value; v9/v10 stored a bare `laneId` that
 *  was absent when the lane resolved at render time. */
function parseLegLane(r: Record<string, unknown>): LegLane {
  const raw = r.lane as Record<string, unknown> | undefined;
  if (raw?.kind === 'pinned' && typeof raw.laneId === 'string')
    return { kind: 'pinned', laneId: raw.laneId };
  if (raw?.kind === 'auto') return { kind: 'auto' };
  if (typeof r.laneId === 'string') return { kind: 'pinned', laneId: r.laneId };
  return { kind: 'auto' };
}

/** A pattern's sections (v12+). A section whose legs all fail to parse is
 *  dropped rather than kept empty, and a `split` needs BOTH sides — one side
 *  alone is a line that goes out and never comes back, which is a real thing
 *  to have drawn but not a thing to silently invent from a bad record. */
/** Per-direction skipped stops (v13+). Station ids are validated against the
 *  document later — a skip naming a station that no longer exists is the one
 *  way this can go stale, and it is dropped in finish(). */
/** v14 stores every way a station rides; v13 and earlier stored at most one.
 *  A lone `anchor` becomes a one-element list, which is what every station in
 *  every older document was. */
function parseAnchors(raw: unknown, legacy: StationAnchor | undefined): StationAnchor[] {
  if (Array.isArray(raw)) {
    const out: StationAnchor[] = [];
    for (const entry of raw) {
      const r = entry as Record<string, unknown>;
      const t = normalizedT(r.t);
      if (typeof r.wayId === 'string' && t !== undefined) out.push({ wayId: r.wayId, t });
    }
    if (out.length > 0) return out;
  }
  return legacy ? [legacy] : [];
}

function parseSkippedStops(raw: unknown): Partial<Record<RunDirection, string[]>> | undefined {
  const r = raw as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return undefined;
  const out: Partial<Record<RunDirection, string[]>> = {};
  for (const run of ['outbound', 'inbound'] as const) {
    const ids = strings(r[run]);
    if (ids.length > 0) out[run] = ids;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseSections(raw: unknown[]): PatternSection[] {
  const out: PatternSection[] = [];
  for (const entry of raw) {
    const r = entry as Record<string, unknown>;
    if (!r) continue;
    if (r.kind === 'split') {
      const outbound = parseLegs(r.outbound).filter(isResolvedLeg);
      const inbound = parseLegs(r.inbound).filter(isResolvedLeg);
      if (outbound.length === 0 || inbound.length === 0) continue;
      out.push({ kind: 'split', outbound, inbound });
      continue;
    }
    if (r.kind !== 'shared' && r.kind !== 'turnaround') continue;
    const legs = parseLegs(r.legs).filter(isResolvedLeg);
    if (legs.length === 0) continue;
    out.push({ kind: r.kind, legs });
  }
  return out;
}

/** A v12 leg always carries its direction; one that does not is a record we
 *  cannot place, and guessing it from continuity is exactly the derivation
 *  that reads a couplet as broken. */
function isResolvedLeg(leg: DraftLeg): leg is PatternLeg {
  return leg.direction !== undefined;
}

function parseLegs(raw: unknown): DraftLeg[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l): DraftLeg | null => {
      const r = l as Record<string, unknown>;
      if (!r || typeof r.wayId !== 'string') return null;
      return {
        wayId: r.wayId,
        ...parseLegDirection(r),
        extent: parseLegExtent(r),
        lane: parseLegLane(r),
      };
    })
    .filter((l): l is DraftLeg => l !== null);
}

function parsePatterns(raw: unknown, legacyWayIds: unknown): DraftPattern[] {
  if (Array.isArray(raw)) {
    return raw
      .map((p): DraftPattern | null => {
        const r = p as Record<string, unknown>;
        if (typeof r.id !== 'string') return null;
        const name = typeof r.name === 'string' ? r.name : undefined;
        // v12: the path is sections, one per stretch, saying which directions
        // of service ride it.
        if (Array.isArray(r.sections)) {
          const sections = parseSections(r.sections);
          if (sections.length > 0)
            return {
              id: r.id,
              legs: [],
              sections,
              skippedStops: parseSkippedStops(r.skippedStops),
              name,
            };
        }
        // v10–v11: one flat leg list, each leg carrying its own direction,
        // extent, and lane pin. The whole thing is one shared stretch.
        if (Array.isArray(r.legs)) return { id: r.id, legs: parseLegs(r.legs), name };
        // v5–v9: a bare ordered way list plus a wayId-keyed lane map. Every
        // way is covered end to end, since nothing before v10 could say
        // otherwise; direction is filled in by finish().
        const wayIds = strings(r.wayIds);
        const lanes = parseLaneMap(r.lanes, wayIds);
        return {
          id: r.id,
          legs: wayIds.map((wayId) => ({
            wayId,
            extent: { kind: 'whole' as const },
            lane: lanes?.[wayId]
              ? ({ kind: 'pinned', laneId: lanes[wayId] } as const)
              : ({ kind: 'auto' } as const),
          })),
          name,
        };
      })
      .filter((p): p is DraftPattern => p !== null);
  }
  const wayIds = strings(legacyWayIds);
  return wayIds.length > 0
    ? [{ id: shortId(), legs: wayIds.map((wayId) => draftWholeLeg(wayId)) }]
    : [];
}

function parseLine(raw: unknown): Line | null {
  const r = raw as Record<string, unknown>;
  if (!r || typeof r.id !== 'string') return null;
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : 'Line',
    color: typeof r.color === 'string' ? r.color : '#2ea44f',
    serviceIds: strings(r.serviceIds),
  };
}

function parseCurrentService(raw: unknown): DraftService {
  const r = raw as Record<string, unknown>;
  if (!r || typeof r.id !== 'string') throw new Error('Bad service');
  const path = r.path as Record<string, unknown> | undefined;
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : undefined,
    modeId: typeof r.modeId === 'string' ? r.modeId : 'bus',
    path: {
      id: r.id,
      legs: [],
      sections: Array.isArray(path?.sections) ? parseSections(path.sections) : [],
      skippedStops: parseSkippedStops(path?.skippedStops),
    },
    vehicleKindId: typeof r.vehicleKindId === 'string' ? r.vehicleKindId : undefined,
    frequencyMinutes: typeof r.frequencyMinutes === 'number' ? r.frequencyMinutes : undefined,
    spanStart: typeof r.spanStart === 'string' ? r.spanStart : undefined,
    spanEnd: typeof r.spanEnd === 'string' ? r.spanEnd : undefined,
    schedule: parseSchedule(r.schedule),
  };
}

function uniqueMigratedServiceId(preferred: string, lineId: string, usedIds: Set<string>): string {
  if (!usedIds.has(preferred)) {
    usedIds.add(preferred);
    return preferred;
  }
  const base = `${lineId}-${preferred}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) candidate = `${base}-${suffix++}`;
  usedIds.add(candidate);
  return candidate;
}

function parseLegacyLinesAndServices(rawServices: unknown[]): {
  lines: Line[];
  services: DraftService[];
} {
  const lines: Line[] = [];
  const services: DraftService[] = [];
  const usedServiceIds = new Set<string>();

  for (const raw of rawServices) {
    const r = raw as Record<string, unknown>;
    if (!r || typeof r.id !== 'string') throw new Error('Bad service');
    const patterns = parsePatterns(r.patterns, r.wayIds);
    const migratedPatterns =
      patterns.length > 0
        ? patterns
        : [{ id: r.id, legs: [], sections: [] } satisfies DraftPattern];
    const serviceIds: string[] = [];

    for (const pattern of migratedPatterns) {
      const id = uniqueMigratedServiceId(pattern.id, r.id, usedServiceIds);
      serviceIds.push(id);
      services.push({
        id,
        name: pattern.name,
        modeId: typeof r.modeId === 'string' ? r.modeId : 'bus',
        path: { ...pattern, id },
        vehicleKindId: typeof r.vehicleKindId === 'string' ? r.vehicleKindId : undefined,
        frequencyMinutes: typeof r.frequencyMinutes === 'number' ? r.frequencyMinutes : undefined,
        spanStart: typeof r.spanStart === 'string' ? r.spanStart : undefined,
        spanEnd: typeof r.spanEnd === 'string' ? r.spanEnd : undefined,
        schedule: parseSchedule(r.schedule),
      });
    }

    lines.push({
      id: r.id,
      name: typeof r.name === 'string' ? r.name : 'Line',
      color: typeof r.color === 'string' ? r.color : '#2ea44f',
      serviceIds,
    });
  }

  return { lines, services };
}

/** Fill in the direction of every leg a pre-v10 document couldn't record,
 *  deriving it from the geometry of the ways the document actually contains.
 *  Runs once the whole system is assembled, because that derivation needs the
 *  ways. A v10 leg already says which way it runs and is left alone. */
function resolveLegDirections(patterns: DraftPattern[], ways: Way[]): Pattern[] {
  const byId = wayById(ways);
  return patterns.map((p) => {
    const { legs, sections, ...rest } = p;
    // A v12 document already said which directions ride what; there is nothing
    // to derive and deriving anyway would read a couplet's two halves as one
    // broken line.
    if (sections) return { ...rest, sections };
    if (legs.every((l) => l.direction !== undefined))
      return { ...rest, sections: oneSection(legs as PatternLeg[]) };
    // Only a pre-v11 document can be missing a direction, and no pre-v12
    // document can be split, so the whole leg list is one continuous path and
    // continuity derivation reads it correctly.
    const derived = deriveLegDirections(
      byId,
      legs.map((l) => l.wayId),
    );
    return {
      ...rest,
      sections: oneSection(
        legs.map((l, i) => ({
          ...l,
          direction: l.direction ?? (derived[i] ? 'withPoints' : 'againstPoints'),
        })) as PatternLeg[],
      ),
    };
  });
}

const SCHEDULE_DAY_SCOPES = new Set(['daily', 'weekday', 'weekend']);

/** v7+ stores a service's optional detailed `schedule` (see system.ts's
 *  SchedulePeriod comment); absent on anything older, which just keeps
 *  using frequencyMinutes/spanStart/spanEnd directly. A malformed period
 *  (missing/bad fields) is dropped rather than defaulted — a half-broken
 *  period is worse than a shorter list. */
function parseSchedule(raw: unknown): SchedulePeriod[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const periods = raw
    .map((p): SchedulePeriod | null => {
      const r = p as Record<string, unknown>;
      if (typeof r.id !== 'string' || typeof r.label !== 'string') return null;
      if (typeof r.spanStart !== 'string' || typeof r.spanEnd !== 'string') return null;
      if (typeof r.frequencyMinutes !== 'number' || r.frequencyMinutes <= 0) return null;
      const days =
        typeof r.days === 'string' && SCHEDULE_DAY_SCOPES.has(r.days)
          ? (r.days as ScheduleDayScope)
          : 'daily';
      return {
        id: r.id,
        label: r.label,
        days,
        spanStart: r.spanStart,
        spanEnd: r.spanEnd,
        frequencyMinutes: r.frequencyMinutes,
      };
    })
    .filter((p): p is SchedulePeriod => p !== null);
  return periods.length > 0 ? periods : undefined;
}

function parseV3(o: Record<string, unknown>): TransitSystem {
  const rawWays = Array.isArray(o.ways) ? o.ways : [];
  const rawServices = Array.isArray(o.services) ? o.services : [];
  const rawStations = Array.isArray(o.stations) ? o.stations : [];
  const rawFacilities = Array.isArray(o.facilities) ? o.facilities : [];
  const rawGroups = Array.isArray(o.groups) ? o.groups : [];

  const ways: Way[] = rawWays.map((w) => {
    const r = w as Record<string, unknown>;
    if (typeof r.id !== 'string') throw new Error('Bad way');
    const typeId = typeof r.typeId === 'string' ? r.typeId : 'rail';
    // v6 stores the cross-section; v3–v5 stored a scalar capacity — migrate
    // it into an equivalent default profile (lane split per profile.ts).
    const profile =
      parseProfile(r.profile) ??
      defaultProfileFor(typeId, typeof r.capacity === 'number' ? r.capacity : undefined);
    return {
      id: r.id,
      typeId,
      points: coords(r.points),
      geometry: geometryOf(r.geometry),
      grade: gradeOf(r.grade),
      profile,
      classId: typeof r.classId === 'string' ? r.classId : undefined,
      source: typeof r.source === 'string' ? r.source : undefined,
    };
  });

  const currentVersion = typeof o.version === 'number' && o.version >= 15;
  const parsed = currentVersion
    ? {
        lines: (Array.isArray(o.lines) ? o.lines : [])
          .map(parseLine)
          .filter((line): line is Line => line !== null),
        services: rawServices.map(parseCurrentService),
      }
    : parseLegacyLinesAndServices(rawServices);

  const stations: Station[] = rawStations.map((s) => parseStation(s));

  const facilities = rawFacilities.map((f) => {
    const r = f as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.typeId !== 'string') throw new Error('Bad facility');
    const geometry = normalizedLngLat(r.geometry) ?? coords(r.geometry);
    return {
      id: r.id,
      typeId: r.typeId,
      name: typeof r.name === 'string' ? r.name : undefined,
      geometry,
    };
  });

  const groups = rawGroups.map((g) => {
    const r = g as Record<string, unknown>;
    if (typeof r.id !== 'string') throw new Error('Bad group');
    const footprint = Array.isArray(r.footprint) ? coords(r.footprint) : undefined;
    return {
      id: r.id,
      name: typeof r.name === 'string' ? r.name : undefined,
      memberIds: strings(r.memberIds),
      ...(footprint && footprint.length > 0 ? { footprint } : {}),
      color: typeof r.color === 'string' ? r.color : undefined,
    };
  });

  const nodes: Node[] = Array.isArray(o.nodes)
    ? parseNodes(o.nodes, ways)
    : deriveNodesFromWays(ways);
  const namedWays = parseNamedWays(o.namedWays, ways);

  return finish(o, { ways, ...parsed, stations, facilities, groups, nodes, namedWays });
}

function legacyStationAnchor(raw: unknown): StationAnchor | undefined {
  // wayId (v3), corridorId (v2), lineId (v1) all name the same anchor target.
  const a = raw as Record<string, unknown> | undefined;
  const anchorId =
    typeof a?.wayId === 'string'
      ? a.wayId
      : typeof a?.corridorId === 'string'
        ? a.corridorId
        : typeof a?.lineId === 'string'
          ? a.lineId
          : undefined;
  return anchorId && typeof a?.t === 'number' ? { wayId: anchorId, t: a.t } : undefined;
}

function parseStation(s: unknown): Station {
  const r = s as Record<string, unknown>;
  const stationCoord = normalizedLngLat(r.coord);
  if (typeof r.id !== 'string' || !stationCoord) throw new Error('Bad station');
  const footprint = Array.isArray(r.footprint) ? coords(r.footprint) : undefined;
  const platforms = Array.isArray(r.platforms)
    ? (r.platforms as unknown[]).map((p) => {
        const pr = p as Record<string, unknown>;
        return {
          id: typeof pr.id === 'string' ? pr.id : shortId(),
          points: coords(pr.points),
          edges: typeof pr.edges === 'number' ? pr.edges : undefined,
        };
      })
    : undefined;
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : undefined,
    coord: stationCoord,
    anchors: parseAnchors(r.anchors, legacyStationAnchor(r.anchor)),
    ...(footprint ? { footprint } : {}),
    ...(platforms ? { platforms } : {}),
    ...(typeof r.dwellSeconds === 'number' ? { dwellSeconds: r.dwellSeconds } : {}),
    ...(r.majorStop === true ? { majorStop: true } : {}),
  };
}

/** The way type a migrated v2 corridor gets, from the mode of a service riding it. */
function wayTypeForLegacyCorridor(corridorId: string, rawServices: unknown[]): string {
  for (const s of rawServices) {
    const r = s as Record<string, unknown>;
    if (
      typeof r.mode === 'string' &&
      Array.isArray(r.corridorIds) &&
      r.corridorIds.includes(corridorId)
    ) {
      const typeId = LEGACY_MODE_WAY_TYPE[r.mode];
      if (typeId) return typeId;
    }
  }
  return 'lightRail';
}

// v2 road classes become the "road" way type's facility classes 1:1.
const ROAD_CLASS_IDS = new Set(['arterial', 'collector', 'local', 'transitway']);

function migrateFromV2(o: Record<string, unknown>): TransitSystem {
  const rawStations = Array.isArray(o.stations) ? o.stations : [];
  const rawCorridors = Array.isArray(o.corridors) ? o.corridors : [];
  const rawServices = Array.isArray(o.services) ? o.services : [];
  const rawLines = Array.isArray(o.lines) ? o.lines : []; // legacy v1
  const rawRoads = Array.isArray(o.roads) ? o.roads : [];

  const ways: Way[] = [];
  let lines: Line[] = [];
  let services: DraftService[] = [];

  if (rawCorridors.length > 0 || rawServices.length > 0) {
    for (const c of rawCorridors) {
      const r = c as Record<string, unknown>;
      if (typeof r.id !== 'string') throw new Error('Bad corridor');
      const typeId = wayTypeForLegacyCorridor(r.id, rawServices);
      ways.push({
        id: r.id,
        typeId,
        points: coords(r.points),
        geometry: geometryOf(r.geometry),
        grade: gradeOf(r.grade),
        profile: defaultProfileFor(typeId),
      });
    }
    const migrated = parseLegacyLinesAndServices(
      rawServices.map((s) => {
        const r = s as Record<string, unknown>;
        return { ...r, modeId: r.mode, wayIds: r.corridorIds };
      }),
    );
    lines = migrated.lines;
    services = migrated.services;
  } else {
    // Legacy v1: migrate each line to a rail way + a service.
    const legacyStationCoord = new Map<string, LngLat>();
    for (const s of rawStations) {
      const r = s as Record<string, unknown>;
      const legacyCoord = normalizedLngLat(r.coord);
      if (typeof r.id === 'string' && legacyCoord) legacyStationCoord.set(r.id, legacyCoord);
    }
    for (const l of rawLines) {
      const r = l as Record<string, unknown>;
      if (typeof r.id !== 'string') continue;
      let points = coords(r.points);
      if (points.length === 0 && Array.isArray(r.shape)) points = coords(r.shape);
      if (points.length === 0 && Array.isArray(r.stationIds)) {
        points = strings(r.stationIds)
          .map((id) => legacyStationCoord.get(id))
          .filter((c): c is LngLat => !!c);
      }
      const typeId = (typeof r.mode === 'string' && LEGACY_MODE_WAY_TYPE[r.mode]) || 'lightRail';
      ways.push({
        id: r.id,
        typeId,
        points,
        geometry: geometryOf(r.geometry),
        grade: gradeOf(r.grade),
        profile: defaultProfileFor(typeId),
      });
      const serviceId = `${r.id}-service`;
      lines.push({
        id: r.id,
        name: typeof r.name === 'string' ? r.name : 'Line',
        color: typeof r.color === 'string' ? r.color : '#2ea44f',
        serviceIds: [serviceId],
      });
      services.push({
        id: serviceId,
        modeId: typeof r.mode === 'string' ? r.mode : 'bus',
        path: { id: serviceId, legs: [draftWholeLeg(r.id)] },
      });
    }
  }

  // v2 roads become "road" ways carrying no service (bare infrastructure).
  for (const rd of rawRoads) {
    const r = rd as Record<string, unknown>;
    if (typeof r.id !== 'string' || !Array.isArray(r.coords)) throw new Error('Bad road');
    const classId =
      typeof r.class === 'string' && ROAD_CLASS_IDS.has(r.class) ? r.class : 'arterial';
    ways.push({
      id: r.id,
      typeId: 'road',
      points: coords(r.coords),
      geometry: 'straight',
      grade: 'atGrade',
      profile: defaultProfileFor('road'),
      classId,
    });
  }

  // parseStation already resolves v2's corridorId / v1's lineId onto wayId.
  const stations: Station[] = rawStations.map((s) => parseStation(s));

  return finish(o, {
    ways,
    lines,
    services,
    stations,
    facilities: [],
    groups: [],
    nodes: deriveNodesFromWays(ways),
    namedWays: [],
  });
}

/** A service whose path may still be missing per-leg directions — what every
 *  parse path produces before finish() resolves it against the ways. */
type DraftService = Omit<Service, 'path'> & { path: DraftPattern };

/** A pattern whose skipped-stop list names only stations that still exist,
 *  with the field dropped entirely once nothing survives — so the common case
 *  (no skips at all) round-trips as an absent field rather than an empty one. */
function prunedSkippedStops(pattern: Pattern, liveStationIds: Set<string>): Pattern {
  if (!pattern.skippedStops) return pattern;
  const kept: Partial<Record<RunDirection, string[]>> = {};
  for (const run of ['outbound', 'inbound'] as const) {
    const ids = (pattern.skippedStops[run] ?? []).filter((id) => liveStationIds.has(id));
    if (ids.length > 0) kept[run] = ids;
  }
  const { skippedStops: _dropped, ...rest } = pattern;
  return Object.keys(kept).length > 0 ? { ...rest, skippedStops: kept } : rest;
}

/** What a parse path recovered from a document, before defaults, repair, and
 *  the component maps finish() derives. Services are still drafts here: their
 *  legs have no direction until finish() resolves them against the ways. */
interface FinishParts {
  ways: Way[];
  lines: Line[];
  services: DraftService[];
  stations: Station[];
  facilities: Facility[];
  groups: Group[];
  nodes: Node[];
  namedWays: NamedWay[];
}

function finish(o: Record<string, unknown>, parts: FinishParts): TransitSystem {
  const repaired = repairedParts(parts);
  const vp = o.viewport as Record<string, unknown> | undefined;
  // Normalized, not merely validated. A predicate that answers "is this a
  // coordinate?" while handing back the caller's original value is a guard
  // that lies: it would accept a centre of [1e9, 45] and store it verbatim.
  const center = vp ? normalizedLngLat(vp.center) : null;
  const viewport =
    center && typeof vp?.zoom === 'number' ? { center, zoom: vp.zoom } : { ...DEFAULT_VIEWPORT };

  const palette =
    Array.isArray(o.palette) && o.palette.every((c) => typeof c === 'string')
      ? (o.palette as string[])
      : [...LINE_COLORS];

  // A skip names a station, and a station can be deleted after the skip was
  // set — the one way this record goes stale. Rebuilt against the stations
  // that actually parsed, which is cheap and has no false positives.
  const liveStationIds = new Set(repaired.stations.map((st) => st.id));

  const now = Date.now();
  return {
    version: 15,
    id: typeof o.id === 'string' ? o.id : shortId(),
    name: typeof o.name === 'string' ? o.name : 'Untitled system',
    description: typeof o.description === 'string' ? o.description : undefined,
    viewport,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : now,
    ...repaired,
    // Legs onto a way that is not here are dropped, but the Service and its
    // public Line are NOT. Losing either on load, silently, because a way went
    // missing would be the loader making a planning decision. A Service left
    // riding nothing is what validateSystemQuick's
    // "doesn't run over any way" has always been for — it says so, in the
    // list, and the person deletes it or re-routes it.
    services: repaired.services.map((sv) => {
      const { path, ...service } = sv;
      const resolved = resolveLegDirections([path], repaired.ways)[0];
      const pruned = prunedSkippedStops(resolved, liveStationIds);
      return {
        ...service,
        path: {
          id: service.id,
          sections: prunedToLiveWays(pruned.sections, repaired.ways),
          ...(pruned.skippedStops ? { skippedStops: pruned.skippedStops } : {}),
        },
      };
    }),
    vehicleKinds: parseVehicleKinds(o.vehicleKinds),
    palette,
    drivingSide: drivingSideOf(o.drivingSide),
    turnRestrictions: parseTurnRestrictions(o.turnRestrictions, repaired.ways),
    medians: parseMedians(o.medians, repaired.namedWays),
    approachControls: parseApproachControls(o.approachControls, repaired.ways),
  };
}

/**
 * A document brought back to what the model allows, before anything reads it.
 *
 * These are contradictions rather than choices: a way with one point cannot be
 * drawn, a station cannot ride a way that is not there, a junction cannot join
 * two different kinds of way (see junctions.ts). They arrive from documents
 * saved before a rule existed, from a hand-edited file, or from a migration
 * that had to guess — never from anything a person did in the editor.
 *
 * Repaired here rather than reported, because the person reading a warning
 * about them could do nothing except accept it. What IS worth reporting —
 * a line with a gap in its route, a crossing that should probably be a
 * junction — is left to validate.ts, so the issues list stays a list of
 * things about the network someone is designing.
 */
function repairedParts(parts: FinishParts): FinishParts {
  const ways = parts.ways.filter((w) => w.points.length >= 2);
  const liveWayIds = new Set(ways.map((w) => w.id));
  return {
    ...parts,
    ways,
    stations: prunedAnchors(parts.stations, ways),
    nodes: withSingleTypeArms(
      parts.nodes.map((n) => ({ ...n, refs: n.refs.filter((r) => liveWayIds.has(r.wayId)) })),
      wayTypeIndex(ways),
    ),
    namedWays: parts.namedWays
      .map((n) => ({ ...n, wayIds: n.wayIds.filter((id) => liveWayIds.has(id)) }))
      .filter((n) => n.wayIds.length > 0),
  };
}

/** Stations keep every anchor onto a way that exists, and lose the rest. A
 *  station with no anchors left still stands: it is a stop someone placed,
 *  and where it sits is not in question — only what it rides. */
function prunedAnchors(stations: Station[], ways: Way[]): Station[] {
  const liveWayIds = new Set(ways.map((w) => w.id));
  return stations.map((st) =>
    st.anchors.every((a) => liveWayIds.has(a.wayId))
      ? st
      : { ...st, anchors: st.anchors.filter((a) => liveWayIds.has(a.wayId)) },
  );
}

/** A pattern's sections with every leg onto a missing way dropped. The route
 *  is left with a hole where one was, which validate.ts then reports — that
 *  IS a planning problem, unlike the dangling reference itself. */
function prunedToLiveWays(sections: PatternSection[], ways: Way[]): PatternSection[] {
  const liveWayIds = new Set(ways.map((w) => w.id));
  return pruneSections(
    mapSectionLegs(sections, (legs) => legs.filter((l) => liveWayIds.has(l.wayId))),
  );
}

/** Deep clone a system under a fresh id — used by "Fork". */
export function forkSystem(system: TransitSystem, now = Date.now()): TransitSystem {
  return {
    ...structuredClone(system),
    id: shortId(),
    name: `${system.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
}
