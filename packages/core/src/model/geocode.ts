import type { ImportBBox } from './import';
import type { LngLat } from './system';

export interface PlaceResult {
  label: string;
  center: LngLat;
  boundingBox?: ImportBBox;
  /** ISO 3166-1 alpha-2, lowercase, when the place provider reports one. */
  countryCode?: string;
}

interface PlaceProviderResult {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
  boundingbox?: unknown;
  address?: { country_code?: unknown };
}

function finiteCoordinate(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function parseBoundingBox(value: unknown): ImportBBox | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const south = finiteCoordinate(value[0]);
  const north = finiteCoordinate(value[1]);
  const west = finiteCoordinate(value[2]);
  const east = finiteCoordinate(value[3]);
  if (
    south === undefined ||
    north === undefined ||
    west === undefined ||
    east === undefined ||
    south < -90 ||
    north > 90 ||
    west < -180 ||
    west > 180 ||
    east < -180 ||
    east > 180 ||
    south >= north ||
    west === east
  ) {
    return undefined;
  }
  return { south, north, west, east };
}

/**
 * Validate and normalize the place provider's untrusted JSON. Fetching is
 * deliberately outside core: browsers call TransitMapper's same-origin
 * gateway, while the gateway alone owns upstream policy, caching and limits.
 */
export function parsePlaceResults(value: unknown): PlaceResult[] {
  if (!Array.isArray(value)) throw new Error('Invalid place-search response.');
  const results: PlaceResult[] = [];
  for (const candidate of value as PlaceProviderResult[]) {
    const latitude = finiteCoordinate(candidate.lat);
    const longitude = finiteCoordinate(candidate.lon);
    if (
      typeof candidate.display_name !== 'string' ||
      candidate.display_name.length === 0 ||
      latitude === undefined ||
      longitude === undefined ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      continue;
    }
    const boundingBox = parseBoundingBox(candidate.boundingbox);
    const countryCode = candidate.address?.country_code;
    results.push({
      label: candidate.display_name,
      center: [longitude, latitude],
      ...(boundingBox ? { boundingBox } : {}),
      ...(typeof countryCode === 'string' && countryCode.length === 2
        ? { countryCode: countryCode.toLowerCase() }
        : {}),
    });
  }
  return results;
}
