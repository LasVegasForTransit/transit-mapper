// Routing over EXISTING infrastructure: the pure graph + shortest-path core
// behind (a) drawing a service line that snaps along already-built ways in
// the Network view, and (b) re-binding an already-sketched service onto the
// real street/track network ("adopt existing infrastructure").
//
// The graph is segment-level: each way contributes edges between its
// "anchor points" — its two endpoints plus every control point a junction
// Node references — so a route can turn at any junction, not just at way
// ends. A click in the middle of a block becomes a VIRTUAL anchor connected
// into its enclosing segment with partial costs; materializing the route
// (editor/store.ts) later inserts a real control point + splits there.
//
// Pure and network-free like the rest of model/: everything is testable
// data-in/data-out, and the store owns all mutation. This also makes the
// Dijkstra core a safe future candidate for moving off the main thread (a Web
// Worker) or server-side (apps/worker) if a real simulation ever needs to
// route at a scale that matters — nothing here touches store.ts, the DOM, or
// any other stateful context, so relocating it is a call-site change, not a
// rewrite.

import { getComponent, laneRefKey } from './components';
import { haversineMeters, nearestInsertionPoint } from './geo';
import { type Traversal, wayTraversal } from './profile';
import type { LngLat, Node, TransitSystem, Way } from './system';

/** Where a route starts/ends: a way plus the raw-points insertion produced
 *  by projecting the clicked coordinate onto it (see anchorOnWay). */
export interface RouteAnchor {
  wayId: string;
  /** Insertion index into the way's RAW control points (nearestInsertionPoint). */
  insertIndex: number;
  coord: LngLat;
}

/** One traversed stretch of one way, in RAW control-point indexes. The route
 *  runs fromPoint→toPoint; fromPoint > toPoint means it traverses the way
 *  against its point order, which is a real direction of travel and not a
 *  formality — a leg records it, the lane is picked from it, and the router
 *  refuses it on a one-way street unless asked not to. Endpoints that landed
 *  mid-way carry the fractional coordinate so materialization can splice a
 *  real point in. */
export interface RouteSpan {
  wayId: string;
  fromPoint: number;
  toPoint: number;
  /** Set when the span's start is the route's mid-way start anchor. */
  fromCoord?: LngLat;
  /** Set when the span's end is the route's mid-way end anchor. */
  toCoord?: LngLat;
  /** Both anchors fell inside ONE segment of the way — the span is purely
   *  fractional (fromCoord→toCoord, no raw points between); `seg` is that
   *  segment's upper point index. fromPoint/toPoint are not meaningful. */
  noInterior?: boolean;
  seg?: number;
  /** Set on a span that runs against its way's one-way profile, which only
   *  happens when the rule allowed it anyway — `'ignore'`, or `'preferLegal'`
   *  after nothing legal was found. Feedback for the gesture in progress, NOT
   *  a record: nothing persists it, and a street made one-way UNDER an
   *  existing line never grows one. validate.ts's wrong-way issue is the
   *  durable answer, because it recomputes from the profile every time. */
  wrongWay?: true;
}

export interface RouteResult {
  spans: RouteSpan[];
  lengthM: number;
}

/** Project a map coordinate onto a way as a route anchor, or null when the
 *  way can't host one (fewer than 2 points). */
export function anchorOnWay(way: Way, coord: LngLat): RouteAnchor | null {
  const ins = nearestInsertionPoint(way.points, coord);
  if (!ins) return null;
  return { wayId: way.id, insertIndex: ins.index, coord: ins.coord };
}

// ---- graph construction -----------------------------------------------------

interface Vertex {
  key: string;
  coord: LngLat;
  edges: { to: string; costM: number; span: RouteSpan }[];
}

/** Anchor indexes on a way: endpoints + every junction-referenced point. */
function anchorIndexes(way: Way, nodesByWay: Map<string, number[]>): number[] {
  const set = new Set<number>([0, way.points.length - 1]);
  for (const idx of nodesByWay.get(way.id) ?? []) set.add(idx);
  return [...set].sort((a, b) => a - b);
}

function segmentCost(way: Way, from: number, to: number): number {
  let m = 0;
  for (let i = from; i < to; i++) m += haversineMeters(way.points[i], way.points[i + 1]);
  return m;
}

/** Vertex identity: the shared Node's id when a junction lives at this
 *  point (that's what joins ways together), else a way-local endpoint key. */
function vertexKeyAt(wayId: string, pointIndex: number, nodeAt: Map<string, string>): string {
  return nodeAt.get(`${wayId}:${pointIndex}`) ?? `e:${wayId}:${pointIndex}`;
}

/**
 * How hard a way's one-way profile constrains a route.
 *
 * - `'legal'` — a one-way profile is a hard constraint. No legal path means
 *   no route. Right where the caller can act on a refusal, and right for an
 *   import whose direction is already known.
 * - `'preferLegal'` — try `'legal'`; on failure route as if unconstrained and
 *   mark the offending spans `wrongWay`. Right where a silent refusal would
 *   read to the planner as "my click did nothing" — they get the line, and
 *   they get told what is wrong with it.
 * - `'ignore'` — the orientation-free graph this module had before one-way
 *   profiles were honoured. Kept because it is what a pure connectivity
 *   question wants, not for backwards compatibility.
 */
export type TravelRule = 'legal' | 'preferLegal' | 'ignore';

export interface RouteGraphOptions {
  /** Only ways of these types participate (mode compatibility). */
  allowedTypeIds: Set<string>;
  /** Ways excluded entirely (e.g. a sketch being re-bound routes around itself). */
  excludeWayIds?: Set<string>;
  /** Corridor bias: edges far from this path cost proportionally more, so
   *  the route follows a sketched line instead of any equally-short detour. */
  biasPath?: LngLat[];
  biasWeight?: number;
  /** Defaults to `'legal'`. A system with no one-way ways routes identically
   *  under all three, since a two-way profile admits both edges either way. */
  travel?: TravelRule;
}

/** Whether a way whose profile permits `traversal` may be ridden in the
 *  direction of increasing (`forward`) or decreasing (`backward`) point
 *  index. Under `'ignore'` the caller passes `'both'` and everything opens. */
function allows(traversal: Traversal, forward: boolean): boolean {
  return traversal === 'both' || traversal === (forward ? 'forward' : 'backward');
}

/** The traversal the graph should enforce for `way` — its profile's, or the
 *  unconstrained `'both'` when the caller asked for no enforcement. */
function ruledTraversal(way: Way, rule: TravelRule): Traversal {
  return rule === 'ignore' ? 'both' : wayTraversal(way);
}

const BIAS_SCALE_M = 300; // distance at which the bias multiplier ≈ 1+weight

function biasMultiplier(mid: LngLat, biasPath: LngLat[] | undefined, weight: number): number {
  if (!biasPath || biasPath.length === 0 || weight <= 0) return 1;
  let best = Infinity;
  // Sample against path vertices — the bias only needs to be roughly right.
  for (const p of biasPath) {
    const d = haversineMeters(mid, p);
    if (d < best) best = d;
  }
  return 1 + weight * Math.min(best / BIAS_SCALE_M, 4);
}

/**
 * Whether a route arriving at `node` along `fromWayId` may continue onto
 * `toWayId`.
 *
 * Two records can forbid it, and both are per-LANE while a route has not
 * chosen a lane yet — the chicken-and-egg this deferred on for a while. It is
 * resolved by asking whether ANY lane of the arriving way permits the
 * movement, which is the safe direction: a turn is refused only when every
 * lane that could make it says no. Over-refusing here would send a line the
 * long way round a junction it is allowed to cross, which is worse than
 * letting one through that a lane-level check would later catch.
 *
 * `Node.connectors` is the explicit lane-connectivity graph, stored only once
 * someone customizes turn lanes; absent it is derived by heuristic on demand,
 * and enforcing a heuristic nobody authored would be enforcing our guess. So
 * an absent connector list permits everything.
 *
 * A `TurnRestriction` with an empty `allowedTargets` is a fully blocked lane —
 * how a modal filter is expressed — and blocks every target from that lane.
 */
function turnAllowed(
  node: Node,
  fromWayId: string,
  toWayId: string,
  waysById: Map<string, Way>,
  turnRestrictions: TransitSystem['turnRestrictions'],
): boolean {
  if (fromWayId === toWayId) return true; // continuing along one way is not a turn
  if (node.connectors && node.connectors.length > 0) {
    const linked = node.connectors.some(
      (c) => c.from.wayId === fromWayId && c.to.wayId === toWayId,
    );
    if (!linked) return false;
  }
  const from = waysById.get(fromWayId);
  const lanes = from ? from.profile.lanes : [];
  if (lanes.length === 0) return true;
  let anyRestricted = false;
  for (const lane of lanes) {
    const restriction = getComponent(turnRestrictions, laneRefKey(fromWayId, lane.id));
    if (!restriction) return true; // an unrestricted lane can make the turn
    anyRestricted = true;
    if (restriction.allowedTargets.includes(toWayId)) return true;
  }
  return !anyRestricted;
}

/** Whether a vertex key names a real junction rather than a way-local endpoint
 *  — only a junction can restrict a turn. See vertexKeyAt. */
function junctionIdOf(vertexKey: string): string | null {
  return vertexKey.startsWith('e:') || vertexKey.startsWith('@') ? null : vertexKey;
}

function buildGraph(
  system: TransitSystem,
  opts: RouteGraphOptions,
  rule: TravelRule,
): { vertices: Map<string, Vertex>; nodeAt: Map<string, string> } {
  const vertices = new Map<string, Vertex>();
  const nodeAt = new Map<string, string>(); // "wayId:pointIndex" -> nodeId
  const nodesByWay = new Map<string, number[]>();
  for (const node of system.nodes) {
    for (const ref of node.refs) {
      nodeAt.set(`${ref.wayId}:${ref.pointIndex}`, node.id);
      const arr = nodesByWay.get(ref.wayId) ?? [];
      arr.push(ref.pointIndex);
      nodesByWay.set(ref.wayId, arr);
    }
  }

  const ensure = (key: string, coord: LngLat): Vertex => {
    let v = vertices.get(key);
    if (!v) {
      v = { key, coord, edges: [] };
      vertices.set(key, v);
    }
    return v;
  };

  const weight = opts.biasWeight ?? 0;
  for (const way of system.ways) {
    if (!opts.allowedTypeIds.has(way.typeId)) continue;
    if (opts.excludeWayIds?.has(way.id)) continue;
    if (way.points.length < 2) continue;
    const anchors = anchorIndexes(way, nodesByWay);
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      const keyA = vertexKeyAt(way.id, a, nodeAt);
      const keyB = vertexKeyAt(way.id, b, nodeAt);
      const mid = way.points[Math.floor((a + b) / 2)];
      const cost = segmentCost(way, a, b) * biasMultiplier(mid, opts.biasPath, weight);
      const va = ensure(keyA, way.points[a]);
      const vb = ensure(keyB, way.points[b]);
      // Both vertices exist either way, so a one-way street still JOINS the
      // network at both ends — it just cannot be entered from the far one.
      // Dropping the vertex instead would disconnect everything beyond it.
      const traversal = ruledTraversal(way, rule);
      if (allows(traversal, true))
        va.edges.push({ to: keyB, costM: cost, span: { wayId: way.id, fromPoint: a, toPoint: b } });
      if (allows(traversal, false))
        vb.edges.push({ to: keyA, costM: cost, span: { wayId: way.id, fromPoint: b, toPoint: a } });
    }
  }
  return { vertices, nodeAt };
}

// ---- shortest path ----------------------------------------------------------

/**
 * Shortest route between two anchors over existing infrastructure. Returns
 * null when no connected path exists. Mid-way anchors are handled as virtual
 * vertices spliced into their enclosing segment.
 *
 * Routes ONE direction of travel. A couplet is two calls, which is why
 * nothing here knows about a line's two runs.
 */
export function routeBetween(
  system: TransitSystem,
  from: RouteAnchor,
  to: RouteAnchor,
  opts: RouteGraphOptions,
): RouteResult | null {
  const rule = opts.travel ?? 'legal';
  const legal = routeWithRule(system, from, to, opts, rule === 'ignore' ? 'ignore' : 'legal');
  if (legal || rule !== 'preferLegal') return legal;
  // Nothing legal exists, and the caller would rather show a wrong-way line
  // than swallow the gesture. Re-route unconstrained and say which spans are
  // the problem, so the refusal is visible instead of silent.
  const relaxed = routeWithRule(system, from, to, opts, 'ignore');
  if (!relaxed) return null;
  const waysById = new Map(system.ways.map((w) => [w.id, w]));
  return { ...relaxed, spans: relaxed.spans.map((s) => markWrongWay(s, waysById)) };
}

/** A span tagged when it runs against its way's profile. A `noInterior` span
 *  carries no point order to judge, so it is left alone rather than guessed
 *  at — it covers less than one segment, where a wrong-way warning would be
 *  noise. */
function markWrongWay(span: RouteSpan, waysById: Map<string, Way>): RouteSpan {
  const way = waysById.get(span.wayId);
  if (!way || span.noInterior || span.fromPoint === span.toPoint) return span;
  const forward = span.fromPoint < span.toPoint;
  return allows(wayTraversal(way), forward) ? span : { ...span, wrongWay: true };
}

function routeWithRule(
  system: TransitSystem,
  from: RouteAnchor,
  to: RouteAnchor,
  opts: RouteGraphOptions,
  rule: TravelRule,
): RouteResult | null {
  // Both anchors on ONE way: the route is usually just the stretch of that way
  // between them — the most common gesture (routing along a single street),
  // and one the vertex graph can't represent when both clicks land inside
  // the same block segment.
  //
  // Usually, not always. This path bypasses buildGraph, so it has to apply the
  // one-way rule itself, and when the direct traversal is illegal it must fall
  // THROUGH to the graph rather than refuse: two points on a one-way street
  // are still connected, by going round the block and back up its couplet
  // twin. Refusing here is what would make a couplet undrawable.
  const sameWay = from.wayId === to.wayId ? system.ways.find((w) => w.id === from.wayId) : null;
  if (
    sameWay &&
    opts.allowedTypeIds.has(sameWay.typeId) &&
    !opts.excludeWayIds?.has(sameWay.id) &&
    sameWay.points.length >= 2
  ) {
    const way = sameWay;
    const arcPos = (a: RouteAnchor): number => {
      const seg = Math.max(1, Math.min(a.insertIndex, way.points.length - 1));
      return segmentCost(way, 0, seg - 1) + haversineMeters(way.points[seg - 1], a.coord);
    };
    const posF = arcPos(from);
    const posT = arcPos(to);
    if (Math.abs(posF - posT) < 0.5) return null; // same spot
    const forward = posF < posT;
    if (!allows(ruledTraversal(way, rule), forward))
      return routeOverGraph(system, from, to, opts, rule);
    // Getting here against the profile means the rule permitted it. Stamp the
    // span now, because this is the only place the direction is known: a
    // same-segment span has no meaningful point order for markWrongWay to
    // read, and on a single-segment street that span is the whole route.
    const against = allows(wayTraversal(way), forward) ? {} : ({ wrongWay: true } as const);
    const segF = Math.max(1, Math.min(from.insertIndex, way.points.length - 1));
    const segT = Math.max(1, Math.min(to.insertIndex, way.points.length - 1));
    if (segF === segT) {
      return {
        spans: [
          {
            wayId: way.id,
            fromPoint: segF,
            toPoint: segF,
            fromCoord: from.coord,
            toCoord: to.coord,
            noInterior: true,
            seg: segF,
            ...against,
          },
        ],
        lengthM: Math.abs(posF - posT),
      };
    }
    const span: RouteSpan = forward
      ? {
          wayId: way.id,
          fromPoint: segF,
          toPoint: segT - 1,
          fromCoord: from.coord,
          toCoord: to.coord,
          ...against,
        }
      : {
          wayId: way.id,
          fromPoint: segF - 1,
          toPoint: segT,
          fromCoord: from.coord,
          toCoord: to.coord,
          ...against,
        };
    return { spans: [span], lengthM: Math.abs(posF - posT) };
  }

  return routeOverGraph(system, from, to, opts, rule);
}

/** Dijkstra over the segment graph. Split out from routeWithRule so the
 *  same-way shortcut can hand back to it when the direct traversal is illegal
 *  and the route has to go round the block. */
function routeOverGraph(
  system: TransitSystem,
  from: RouteAnchor,
  to: RouteAnchor,
  opts: RouteGraphOptions,
  rule: TravelRule,
): RouteResult | null {
  const { vertices, nodeAt } = buildGraph(system, opts, rule);
  const waysById = new Map(system.ways.map((w) => [w.id, w]));
  const nodesById = new Map(system.nodes.map((n) => [n.id, n]));

  // Splice a virtual vertex for an anchor into its way's enclosing segment.
  const splice = (anchor: RouteAnchor, key: string, isFrom: boolean): boolean => {
    const way = waysById.get(anchor.wayId);
    if (
      !way ||
      !opts.allowedTypeIds.has(way.typeId) ||
      opts.excludeWayIds?.has(way.id) ||
      way.points.length < 2
    )
      return false;
    const nodesByWay = new Map<string, number[]>();
    for (const node of system.nodes) {
      for (const ref of node.refs) {
        if (ref.wayId !== way.id) continue;
        const arr = nodesByWay.get(way.id) ?? [];
        arr.push(ref.pointIndex);
        nodesByWay.set(way.id, arr);
      }
    }
    const anchors = anchorIndexes(way, nodesByWay);
    // The anchor sits between raw points insertIndex-1 and insertIndex; find
    // the enclosing anchor pair [a, b].
    const seg = Math.max(1, Math.min(anchor.insertIndex, way.points.length - 1));
    let a = anchors[0];
    let b = anchors[anchors.length - 1];
    for (let i = 0; i < anchors.length - 1; i++) {
      if (anchors[i] <= seg - 1 && seg <= anchors[i + 1]) {
        a = anchors[i];
        b = anchors[i + 1];
        break;
      }
    }
    const v: Vertex = { key, coord: anchor.coord, edges: [] };
    // Partial cost: the fractional piece from the anchor to the nearer raw
    // point, plus the whole-point stretch onward to the target index.
    const costTo = (idx: number): number => {
      if (idx <= seg - 1)
        return haversineMeters(way.points[seg - 1], anchor.coord) + segmentCost(way, idx, seg - 1);
      return haversineMeters(anchor.coord, way.points[seg]) + segmentCost(way, seg, idx);
    };
    const keyA = vertexKeyAt(way.id, a, nodeAt);
    const keyB = vertexKeyAt(way.id, b, nodeAt);
    // Leaving the anchor toward a (behind it), the first raw point passed is
    // seg-1; toward b (ahead), it's seg — and mirrored when arriving.
    const spanA: RouteSpan = isFrom
      ? { wayId: way.id, fromPoint: seg - 1, toPoint: a, fromCoord: anchor.coord }
      : { wayId: way.id, fromPoint: a, toPoint: seg - 1, toCoord: anchor.coord };
    const spanB: RouteSpan = isFrom
      ? { wayId: way.id, fromPoint: seg, toPoint: b, fromCoord: anchor.coord }
      : { wayId: way.id, fromPoint: b, toPoint: seg, toCoord: anchor.coord };
    // A mid-way anchor is the second place traversals are created, and it is
    // easy to miss: leaving toward `a` walks the point order DOWN and toward
    // `b` walks it UP, and the mirror edges below run the opposite way again.
    // Gate all four, or a one-way street stays enterable from its far end
    // whenever the click landed mid-block.
    const traversal = ruledTraversal(way, rule);
    const towardA = allows(traversal, false);
    const towardB = allows(traversal, true);
    if (towardA) v.edges.push({ to: keyA, costM: costTo(a), span: spanA });
    if (towardB) v.edges.push({ to: keyB, costM: costTo(b), span: spanB });
    if (!towardA && !towardB) return false;
    vertices.set(key, v);
    // Mirror edges from the segment ends toward the virtual vertex (needed
    // for the destination anchor, which is routed INTO). Arriving from `a`
    // walks the point order up, and from `b` down — the reverse of above.
    if (towardB)
      vertices
        .get(keyA)
        ?.edges.push({ to: key, costM: costTo(a), span: isFrom ? spanA : { ...spanA } });
    if (towardA)
      vertices
        .get(keyB)
        ?.edges.push({ to: key, costM: costTo(b), span: isFrom ? spanB : { ...spanB } });
    return true;
  };

  const FROM = '@from';
  const TO = '@to';
  if (!splice(from, FROM, true) || !splice(to, TO, false)) return null;

  // Dijkstra over (vertex, way arrived on) rather than over vertices alone.
  //
  // A turn restriction is a fact about a PAIR of ways meeting at a junction,
  // so "can I leave along B" depends on how the route got here — which a plain
  // vertex state cannot express. Splitting the state on the arriving way is
  // the edge-expanded graph the deferral note called for, done in the search
  // instead of in the construction: same expansion, but buildGraph stays a
  // description of the network rather than of the ways through it.
  //
  // The cost is bounded by junction degree, and only where a junction actually
  // has several arms — a state is only created for an (arriving way, vertex)
  // pair a route can really reach.
  const stateKey = (vertexKey: string, viaWayId: string): string => `${vertexKey}|${viaWayId}`;
  const START = stateKey(FROM, '');
  const dist = new Map<string, number>();
  const at = new Map<string, { vertexKey: string; viaWayId: string }>();
  const prev = new Map<string, { key: string; span: RouteSpan; costM: number }>();
  const visited = new Set<string>();
  dist.set(START, 0);
  at.set(START, { vertexKey: FROM, viaWayId: '' });

  let goal: string | null = null;
  while (true) {
    let cur: string | null = null;
    let best = Infinity;
    for (const [k, d] of dist) {
      if (!visited.has(k) && d < best) {
        best = d;
        cur = k;
      }
    }
    if (cur === null) return null; // exhausted without reaching TO
    const here = at.get(cur)!;
    if (here.vertexKey === TO) {
      goal = cur;
      break;
    }
    visited.add(cur);
    const v = vertices.get(here.vertexKey);
    if (!v) continue;
    const junction = junctionIdOf(here.vertexKey);
    const node = junction ? nodesById.get(junction) : undefined;
    for (const e of v.edges) {
      // A turn is only restrictable where the route is actually at a junction
      // and is changing ways. Leaving the start anchor has no arriving way and
      // so cannot be a turn.
      if (
        node &&
        here.viaWayId &&
        !turnAllowed(node, here.viaWayId, e.span.wayId, waysById, system.turnRestrictions)
      )
        continue;
      // A zero-length hop does not change which way the route is ON. Anchors
      // spliced exactly onto a junction produce spans covering no ground at
      // all, and letting one of those set the arriving way launders a
      // forbidden turn through a third street the route never travels: enter
      // the junction on A, "use" B for nothing, leave on C, and the A→C rule
      // is never consulted.
      const nextVia = e.costM > 0 ? e.span.wayId : here.viaWayId;
      const nextKey = stateKey(e.to, nextVia);
      const nd = best + e.costM;
      if (nd < (dist.get(nextKey) ?? Infinity)) {
        dist.set(nextKey, nd);
        at.set(nextKey, { vertexKey: e.to, viaWayId: nextVia });
        prev.set(nextKey, { key: cur, span: e.span, costM: e.costM });
      }
    }
  }

  // Walk back, then merge consecutive spans over the same way.
  const raw: RouteSpan[] = [];
  let cursor = goal;
  while (cursor !== START) {
    const p = prev.get(cursor);
    if (!p) return null;
    raw.unshift(p.span);
    cursor = p.key;
  }
  const spans: RouteSpan[] = [];
  for (const s of raw) {
    const last = spans[spans.length - 1];
    // Same way, continuing in the SAME direction. Without the direction test
    // an out-and-back — up a street and straight back down it, which is what a
    // legal U-turn round a forbidden turn looks like — merges into a span from
    // a point to itself, and the detour vanishes into a zero-length nothing.
    const sameDirection =
      last !== undefined &&
      Math.sign(last.toPoint - last.fromPoint) === Math.sign(s.toPoint - s.fromPoint);
    if (
      last &&
      last.wayId === s.wayId &&
      last.toPoint === s.fromPoint &&
      sameDirection &&
      !last.toCoord &&
      !s.fromCoord
    ) {
      last.toPoint = s.toPoint;
      last.toCoord = s.toCoord;
    } else {
      spans.push({ ...s });
    }
  }
  return overlapsItself(spans) ? null : { spans, lengthM: dist.get(goal) ?? 0 };
}

/**
 * Whether a route doubles back over ground it has already covered.
 *
 * This used to reject ANY way named twice, justified by materialization being
 * split-based. It has not been split-based since legs grew extents: a leg
 * names a stretch of a way, so two legs on one way are ordinary. What is still
 * wrong is two spans covering the same stretch the same way round, because
 * `serviceRangesOnWay` merges those into one drawn line and the stop
 * derivation counts the stations under them twice. Two spans on disjoint
 * stretches — a route out along a street and back along a later block of it —
 * are fine, and rejecting them was costing real routes.
 *
 * A `noInterior` span carries no meaningful point order, so it is compared by
 * way alone and any repeat is refused.
 */
function overlapsItself(spans: RouteSpan[]): boolean {
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i];
      const b = spans[j];
      if (a.wayId !== b.wayId) continue;
      if (a.noInterior || b.noInterior) return true;
      const aForward = a.fromPoint < a.toPoint;
      const bForward = b.fromPoint < b.toPoint;
      if (aForward !== bForward) continue; // opposite directions: a couplet, not a doubling
      const lo = Math.max(Math.min(a.fromPoint, a.toPoint), Math.min(b.fromPoint, b.toPoint));
      const hi = Math.min(Math.max(a.fromPoint, a.toPoint), Math.max(b.fromPoint, b.toPoint));
      if (lo < hi) return true;
    }
  }
  return false;
}

/** The route's drawable polyline (raw way points; fractional anchor ends). */
export function routePath(system: TransitSystem, spans: RouteSpan[]): LngLat[] {
  const waysById = new Map(system.ways.map((w) => [w.id, w]));
  const out: LngLat[] = [];
  for (const s of spans) {
    const way = waysById.get(s.wayId);
    if (!way) continue;
    if (s.noInterior) {
      if (s.fromCoord && s.toCoord) out.push(s.fromCoord, s.toCoord);
      continue;
    }
    const pts: LngLat[] = [];
    if (s.fromCoord) pts.push(s.fromCoord);
    const step = s.fromPoint <= s.toPoint ? 1 : -1;
    for (let i = s.fromPoint; step > 0 ? i <= s.toPoint : i >= s.toPoint; i += step) {
      if (way.points[i]) pts.push(way.points[i]);
    }
    if (s.toCoord) pts.push(s.toCoord);
    out.push(...pts);
  }
  return out;
}
