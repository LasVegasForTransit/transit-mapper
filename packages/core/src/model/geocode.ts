// Place search for the "start a new system somewhere real" flow — the one
// function here that touches the network, same split as import.ts (pure
// transforms are trivial here, so there's only fetchNominatim itself).
import type { LngLat } from './system';
import type { ImportBBox } from './import';

export interface PlaceResult {
  label: string;
  center: LngLat;
  boundingBox?: ImportBBox;
  /** ISO 3166-1 alpha-2, lowercase, when Nominatim reports one — used to
   *  infer a new system's driving side. */
  countryCode?: string;
}

export interface GeocodeOptions {
  signal?: AbortSignal;
  /** Injectable for deterministic network-boundary tests. */
  fetcher?: typeof fetch;
}

// Nominatim's usage policy has no public-mirror fallback the way Overpass
// does — a single endpoint is a real, accepted limitation here, not an
// oversight.
const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

interface NominatimResult {
  display_name?: string;
  lat?: string;
  lon?: string;
  boundingbox?: [string, string, string, string]; // [south, north, west, east]
  address?: { country_code?: string };
}

/** Search OpenStreetMap's place index for a free-text query (city, address,
 *  landmark). Returns an empty array for no matches or a malformed response
 *  — never throws on "nothing found," only on a genuine network failure. */
export async function searchPlaces(
  query: string,
  options: GeocodeOptions = {},
): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', '6');
  url.searchParams.set('q', trimmed);
  const response = await (options.fetcher ?? fetch)(url.toString(), { signal: options.signal });
  if (!response.ok) throw new Error(`Place search failed (${response.status}).`);
  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) return [];
  const results: PlaceResult[] = [];
  for (const entry of data as NominatimResult[]) {
    const lat = entry.lat !== undefined ? Number(entry.lat) : NaN;
    const lon = entry.lon !== undefined ? Number(entry.lon) : NaN;
    if (!entry.display_name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const bb = entry.boundingbox;
    const boundingBox: ImportBBox | undefined =
      bb && bb.length === 4
        ? { south: Number(bb[0]), north: Number(bb[1]), west: Number(bb[2]), east: Number(bb[3]) }
        : undefined;
    results.push({
      label: entry.display_name,
      center: [lon, lat],
      boundingBox,
      countryCode: entry.address?.country_code,
    });
  }
  return results;
}
