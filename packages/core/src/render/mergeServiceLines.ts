import type { Feature, LineString } from 'geojson';
import type { LngLat } from '../model/system';

// buildFeatures can emit several paint fragments for one service on one way
// (trimmed semantic ranges and lane-resolved stretches). Rejoining those
// same-corridor pieces lets MapLibre miter their interior joints. Distinct ways
// stay distinct even when their endpoints meet: differential source updates
// address service geometry by corridor, so a cross-way feature would give one
// edit ownership of an unchanged neighbour.

function pointKey(p: LngLat): string {
  return `${p[0]},${p[1]}`;
}

// Paint properties and the corridor owner must match. Service identity alone
// cannot authorize merging across a differential replacement boundary.
function mergeKey(props: Record<string, unknown>): string {
  return [
    'serviceId',
    'modeId',
    'typeId',
    'wayId',
    'offset',
    'underground',
    'elevated',
    'w14',
    'renderTier',
    'tierOpacity',
    'projectedWidthPx',
    'hasOverviewTier',
    'hasDistrictTier',
    'hasStreetTier',
  ]
    .map((key) => String(props[key]))
    .join('\u001f');
}

/** Re-join same-run, same-corridor fragments that meet at a shared coordinate.
 * A point where three or more fragments meet is a real divergence, so only a
 * joint with exactly two fragment ends is fused. */
export function mergeAdjacentServiceLines(features: Feature<LineString>[]): Feature<LineString>[] {
  const groups = new Map<string, Feature<LineString>[]>();
  for (const f of features) {
    const key = mergeKey(f.properties ?? {});
    const arr = groups.get(key);
    if (arr) arr.push(f);
    else groups.set(key, [f]);
  }

  const out: Feature<LineString>[] = [];
  for (const group of groups.values()) {
    out.push(...mergeGroup(group));
  }
  return out;
}

interface End {
  frag: Feature<LineString>;
  end: 'start' | 'end';
}

interface RunAssembly {
  byEndpoint: Map<string, End[]>;
  used: Set<Feature<LineString>>;
  constituents: Feature<LineString>[];
  // A closed loop (a terminus loop) would revisit fragments forever once
  // every one is already used, so every walk is bounded by the group size.
  maxSteps: number;
}

// Only a degree-2 joint is unambiguous: this fragment's end plus exactly
// one other fragment's end, nothing more.
function indexUnambiguousEnds(frags: Feature<LineString>[]): Map<string, End[]> {
  const degree = new Map<string, number>();
  const bump = (k: string) => degree.set(k, (degree.get(k) ?? 0) + 1);
  for (const f of frags) {
    const c = f.geometry.coordinates as LngLat[];
    bump(pointKey(c[0]));
    bump(pointKey(c[c.length - 1]));
  }

  const byEndpoint = new Map<string, End[]>();
  const addEnd = (key: string, e: End) => {
    if (degree.get(key) !== 2) return;
    const arr = byEndpoint.get(key);
    if (arr) arr.push(e);
    else byEndpoint.set(key, [e]);
  };
  for (const f of frags) {
    const c = f.geometry.coordinates as LngLat[];
    addEnd(pointKey(c[0]), { frag: f, end: 'start' });
    addEnd(pointKey(c[c.length - 1]), { frag: f, end: 'end' });
  }
  return byEndpoint;
}

/** Claims the single unused fragment meeting `at`, or nothing when the joint
 *  is ambiguous or already consumed. */
function takeNeighbour(run: RunAssembly, at: LngLat): End | null {
  const candidates = (run.byEndpoint.get(pointKey(at)) ?? []).filter((c) => !run.used.has(c.frag));
  if (candidates.length !== 1) return null;
  const chosen = candidates[0];
  run.used.add(chosen.frag);
  run.constituents.push(chosen.frag);
  return chosen;
}

function extendForward(run: RunAssembly, coords: LngLat[]): void {
  for (let step = run.maxSteps; step > 0; step -= 1) {
    const next = takeNeighbour(run, coords[coords.length - 1]);
    if (!next) return;
    const points = next.frag.geometry.coordinates as LngLat[];
    coords.push(...(next.end === 'start' ? points : [...points].reverse()).slice(1));
  }
}

function extendBackward(run: RunAssembly, coords: LngLat[]): LngLat[] {
  let result = coords;
  for (let step = run.maxSteps; step > 0; step -= 1) {
    const prev = takeNeighbour(run, result[0]);
    if (!prev) return result;
    const points = prev.frag.geometry.coordinates as LngLat[];
    result = [...(prev.end === 'end' ? points : [...points].reverse()).slice(0, -1), ...result];
  }
  return result;
}

function mergeGroup(frags: Feature<LineString>[]): Feature<LineString>[] {
  if (frags.length <= 1) return frags;

  const byEndpoint = indexUnambiguousEnds(frags);
  const used = new Set<Feature<LineString>>();
  const out: Feature<LineString>[] = [];
  for (const seed of frags) {
    if (used.has(seed)) continue;
    used.add(seed);
    const constituents = [seed];
    const run: RunAssembly = { byEndpoint, used, constituents, maxSteps: frags.length };
    const coords = [...(seed.geometry.coordinates as LngLat[])];

    // Extend toward the end, then toward the start.
    extendForward(run, coords);
    out.push(mergedFeature(seed, constituents, extendBackward(run, coords)));
  }
  return out;
}

function mergedFeature(
  seed: Feature<LineString>,
  constituents: readonly Feature<LineString>[],
  coordinates: LngLat[],
): Feature<LineString> {
  const constituentIds = constituents
    .map((feature) => feature.id)
    .filter((id): id is string | number => id !== undefined)
    .map(String)
    .sort();
  // Constituents are disjoint across the merged output. Their lexical
  // minimum is therefore a compact, collision-free identity for this run,
  // stable across traversal order and coordinate-only edits. Concatenating
  // every ID made a long route's top-level ID grow with its way count.
  if (constituentIds.length === 0) {
    return { ...seed, geometry: { type: 'LineString', coordinates } };
  }
  return {
    ...seed,
    id: constituentIds[0],
    geometry: { type: 'LineString', coordinates },
  };
}
