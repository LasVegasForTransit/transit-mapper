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

function mergeGroup(frags: Feature<LineString>[]): Feature<LineString>[] {
  if (frags.length <= 1) return frags;

  const degree = new Map<string, number>();
  const bump = (k: string) => degree.set(k, (degree.get(k) ?? 0) + 1);
  for (const f of frags) {
    const c = f.geometry.coordinates as LngLat[];
    bump(pointKey(c[0]));
    bump(pointKey(c[c.length - 1]));
  }

  // Only a degree-2 joint is unambiguous: this fragment's end plus exactly
  // one other fragment's end, nothing more.
  interface End {
    frag: Feature<LineString>;
    end: 'start' | 'end';
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

  const used = new Set<Feature<LineString>>();
  const out: Feature<LineString>[] = [];
  for (const seed of frags) {
    if (used.has(seed)) continue;
    used.add(seed);
    const constituents = [seed];
    let coords = [...(seed.geometry.coordinates as LngLat[])];

    // Extend toward the end, then toward the start. Bounded by the group
    // size — a closed loop (a terminus loop) would otherwise spin forever
    // once every fragment is already used.
    for (let guard = 0; guard < frags.length; guard++) {
      const candidates = (byEndpoint.get(pointKey(coords[coords.length - 1])) ?? []).filter(
        (c) => !used.has(c.frag),
      );
      if (candidates.length !== 1) break;
      const { frag, end } = candidates[0];
      used.add(frag);
      constituents.push(frag);
      const next = frag.geometry.coordinates as LngLat[];
      coords.push(...(end === 'start' ? next : [...next].reverse()).slice(1));
    }
    for (let guard = 0; guard < frags.length; guard++) {
      const candidates = (byEndpoint.get(pointKey(coords[0])) ?? []).filter(
        (c) => !used.has(c.frag),
      );
      if (candidates.length !== 1) break;
      const { frag, end } = candidates[0];
      used.add(frag);
      constituents.push(frag);
      const prev = frag.geometry.coordinates as LngLat[];
      coords = [...(end === 'end' ? prev : [...prev].reverse()).slice(0, -1), ...coords];
    }

    out.push(mergedFeature(seed, constituents, coords));
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
