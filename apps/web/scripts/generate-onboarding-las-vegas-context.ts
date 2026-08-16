import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const BOUNDS = { west: -115.17, south: 36.15, east: -115.124, north: 36.177 } as const;
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;
const OUTPUT_PATH = path.resolve('src/ui/onboarding/las-vegas-context-data.json');
// Long ways preserve the recognizable grid while omitting block-sized OSM
// fragments that are invisible at onboarding scale and would inflate the
// first-run download. Rail stays complete because its geometry is sparse.
const MIN_CONTEXT_SPAN = 0.0057;

interface OverpassNode {
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: 'way';
  id: number;
  tags?: Partial<Record<string, string>>;
  geometry?: OverpassNode[];
}

interface OverpassResponse {
  osm3s?: { timestamp_osm_base?: string };
  elements: OverpassWay[];
}

type ContextKind = 'motorway' | 'major' | 'street' | 'rail';
type Position = [number, number];

const namedGrid = [
  'Bonneville',
  'Bridger',
  'Bruce',
  'Carson',
  'Casino Center',
  'Charleston',
  'Clark',
  'Commerce',
  'Fremont',
  'Garces',
  'Gass',
  'Hoover',
  'Las Vegas',
  'Lewis',
  'Main',
  'Maryland',
  'Mesquite',
  'Ogden',
  'Rancho',
  'Sahara',
  'Shadow',
  'Stewart',
  'St Louis',
  '1st',
  '2nd',
  '3rd',
  '4th',
  '5th',
  '6th',
  '7th',
  '8th',
  '9th',
  '10th',
  '11th',
  '12th',
  '13th',
] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function query(): string {
  const bbox = `${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east}`;
  const gridNames = namedGrid.map(escapeRegex).join('|');
  return `[out:json][timeout:180];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$"](${bbox});
  way["highway"~"^(residential|unclassified|living_street)$"]["name"~"(${gridNames})",i](${bbox});
  way["railway"~"^(rail|light_rail|tram)$"](${bbox});
);
out tags geom;`;
}

function contextKind(tags: Partial<Record<string, string>>): ContextKind | undefined {
  if (tags.railway) return 'rail';
  if (/^(motorway|motorway_link|trunk|trunk_link)$/.test(tags.highway ?? '')) return 'motorway';
  if (/^(primary|primary_link|secondary|secondary_link)$/.test(tags.highway ?? '')) return 'major';
  if (tags.highway) return 'street';
  return undefined;
}

function canonicalName(name: string | undefined): string | null {
  if (!name) return null;
  return name
    .replace(/^(East|West|North|South)\s+/i, '')
    .replace(/\b(Boulevard|Avenue|Street|Road|Drive|Lane|Parkway)\b.*$/i, (suffix) => suffix)
    .replace(/^Las Vegas Boulevard(?: North| South)?$/i, 'Las Vegas Boulevard');
}

function rounded(value: number): number {
  // Six decimal places preserve sub-meter geometry, well beyond the preview's
  // display scale, without shipping meaningless source precision.
  return Math.round(value * 1_000_000) / 1_000_000;
}

function inside([x, y]: Position): boolean {
  return x >= BOUNDS.west && x <= BOUNDS.east && y >= BOUNDS.south && y <= BOUNDS.north;
}

/** Liang-Barsky clipping preserves a segment crossing the frame even when
 * neither OSM vertex lies inside it. This makes regeneration independent of
 * how a mapper happened to split the source way. */
function clipSegment(a: Position, b: Position): [Position, Position] | undefined {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let lower = 0;
  let upper = 1;
  const edges: Array<[number, number]> = [
    [-dx, a[0] - BOUNDS.west],
    [dx, BOUNDS.east - a[0]],
    [-dy, a[1] - BOUNDS.south],
    [dy, BOUNDS.north - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0 && q < 0) return undefined;
    if (p === 0) continue;
    const ratio = q / p;
    if (p < 0) lower = Math.max(lower, ratio);
    else upper = Math.min(upper, ratio);
    if (lower > upper) return undefined;
  }
  return [
    [rounded(a[0] + lower * dx), rounded(a[1] + lower * dy)],
    [rounded(a[0] + upper * dx), rounded(a[1] + upper * dy)],
  ];
}

function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function clipLine(points: Position[]): Position[][] {
  const lines: Position[][] = [];
  let current: Position[] = [];
  for (let index = 1; index < points.length; index++) {
    const segment = clipSegment(points[index - 1], points[index]);
    if (!segment) {
      if (current.length > 1) lines.push(current);
      current = [];
      continue;
    }
    const currentEnd = current.at(-1);
    if (!currentEnd || !samePosition(currentEnd, segment[0])) {
      if (current.length > 1) lines.push(current);
      current = [segment[0]];
    }
    const segmentStart = current.at(-1);
    if (!segmentStart || !samePosition(segmentStart, segment[1])) current.push(segment[1]);
  }
  if (current.length > 1) lines.push(current);
  return lines.filter((line) => line.some(inside));
}

async function fetchSnapshot(): Promise<OverpassResponse> {
  const failures: string[] = [];
  for (const url of OVERPASS_URLS) {
    const requestUrl = new URL(url);
    requestUrl.searchParams.set('data', query());
    const response = await fetch(requestUrl, {
      headers: { 'user-agent': 'TransitMapper onboarding snapshot generator' },
    });
    if (response.ok) return (await response.json()) as OverpassResponse;
    failures.push(`${url}: ${response.status} ${response.statusText}`);
  }
  throw new Error(`Every Overpass endpoint failed:\n${failures.join('\n')}`);
}

const payload = await fetchSnapshot();

const features = payload.elements
  .flatMap((way) => {
    const kind = contextKind(way.tags ?? {});
    if (!kind || !way.geometry) return [];
    const points = way.geometry.map(({ lon, lat }): Position => [lon, lat]);
    return clipLine(points).map((coordinates, part) => ({
      type: 'Feature' as const,
      properties: {
        osmWayId: way.id,
        name: canonicalName(way.tags?.name),
        kind,
        part,
      },
      geometry: { type: 'LineString' as const, coordinates },
    }));
  })
  .sort(
    (a, b) =>
      a.properties.osmWayId - b.properties.osmWayId || a.properties.part - b.properties.part,
  );

const essentialNames = new Set(['Charleston Boulevard', 'Las Vegas Boulevard', 'Fremont Street']);
function featureSpan(feature: (typeof features)[number]): number {
  const coordinates = feature.geometry.coordinates;
  const lngs = coordinates.map(([lng]) => lng);
  const lats = coordinates.map(([, lat]) => lat);
  return Math.max(...lngs) - Math.min(...lngs) + Math.max(...lats) - Math.min(...lats);
}

const selectedFeatures = features.filter((feature) => {
  if (feature.properties.kind === 'rail') return true;
  return featureSpan(feature) >= MIN_CONTEXT_SPAN;
});
for (const name of essentialNames) {
  if (selectedFeatures.some((feature) => feature.properties.name === name)) continue;
  const longest = features
    .filter((feature) => feature.properties.name === name)
    .sort((a, b) => featureSpan(b) - featureSpan(a))
    .at(0);
  if (longest) selectedFeatures.push(longest);
}
selectedFeatures.sort(
  (a, b) => a.properties.osmWayId - b.properties.osmWayId || a.properties.part - b.properties.part,
);

const snapshot = {
  attribution: '© OpenStreetMap contributors',
  sourceUrl: 'https://www.openstreetmap.org/copyright',
  generatedAt: payload.osm3s?.timestamp_osm_base ?? new Date().toISOString(),
  bounds: BOUNDS,
  featureCollection: { type: 'FeatureCollection' as const, features: selectedFeatures },
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Wrote ${selectedFeatures.length} clipped OSM ways to ${OUTPUT_PATH}`);
