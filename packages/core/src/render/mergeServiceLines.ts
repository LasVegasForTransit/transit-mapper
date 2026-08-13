import type { Feature, LineString } from 'geojson';
import type { LngLat } from '../model/system';
// buildFeatures emits one service-line feature per WAY a service rides (it has
// to, in order to dedupe several riders sharing one way into a single offset
// slot per way). But `line-offset` is a per-feature paint property: MapLibre
// miters it only across a feature's OWN interior vertices, so a fragment's
// first/last vertex — which is exactly where one way hands off to the next —
// is offset perpendicular to just that fragment's own end segment. Where the
// next way bends away from that direction, the two fragments' offset copies
// land at different points and visibly pull apart, even though they are one
// continuous, constantly-offset line for the same service. This re-joins
// fragments that belong to the same rendered run, so MapLibre miters the
// junction using both neighbouring segments instead of neither.

function pointKey(p: LngLat): string {
  return `${p[0]},${p[1]}`;
}

// Only the paint-relevant properties have to match for two fragments to be
// the same rendered run; `wayId` is expected to differ (that's the whole
// reason there are two fragments) and is deliberately excluded.
function mergeKey(props: Record<string, unknown>): string {
  return ['serviceId', 'offset', 'underground', 'elevated', 'w14']
    .map((key) => String(props[key]))
    .join('\u001f');
}

/** Re-join same-run service-line fragments that meet at a shared coordinate
 *  back into one feature, so a bend between two ways doesn't fan the offset
 *  copies apart. A junction where three or more fragments of the same run
 *  meet (a pattern branching, a couplet's ends) is a REAL divergence — there
 *  is no single offset direction that is correct past it — so only a joint
 *  with exactly two fragment-ends is fused; everything else is left as the
 *  loop above produced it. */
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
    let coords = [...(seed.geometry.coordinates as LngLat[])];

    // Extend toward the end, then toward the start. Bounded by the group
    // size — a closed loop (a terminus loop) would otherwise spin forever
    // once every fragment is already used.
    for (const _fragment of frags) {
      const candidates = (byEndpoint.get(pointKey(coords[coords.length - 1])) ?? []).filter(
        (c) => !used.has(c.frag),
      );
      if (candidates.length !== 1) break;
      const { frag, end } = candidates[0];
      used.add(frag);
      const next = frag.geometry.coordinates as LngLat[];
      coords.push(...(end === 'start' ? next : [...next].reverse()).slice(1));
    }
    for (const _fragment of frags) {
      const candidates = (byEndpoint.get(pointKey(coords[0])) ?? []).filter(
        (c) => !used.has(c.frag),
      );
      if (candidates.length !== 1) break;
      const { frag, end } = candidates[0];
      used.add(frag);
      const prev = frag.geometry.coordinates as LngLat[];
      coords = [...(end === 'end' ? prev : [...prev].reverse()).slice(0, -1), ...coords];
    }

    out.push({ ...seed, geometry: { type: 'LineString', coordinates: coords } });
  }
  return out;
}
