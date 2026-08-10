import type { PlaceResult } from '@transitmapper/core/model/geocode';

interface PlaceSearchError {
  error?: unknown;
}

function coordinateInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function validCenter(value: unknown): value is PlaceResult['center'] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  return coordinateInRange(value[0], -180, 180) && coordinateInRange(value[1], -90, 90);
}

function validBoundingBox(value: unknown): value is NonNullable<PlaceResult['boundingBox']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const box = value as Record<string, unknown>;
  if (!coordinateInRange(box.west, -180, 180)) return false;
  if (!coordinateInRange(box.east, -180, 180)) return false;
  if (!coordinateInRange(box.south, -90, 90)) return false;
  if (!coordinateInRange(box.north, -90, 90)) return false;
  return box.west !== box.east && box.south < box.north;
}

function validPlaceResult(value: unknown): value is PlaceResult {
  if (!value || typeof value !== 'object') return false;
  const place = value as Record<string, unknown>;
  if (typeof place.label !== 'string' || place.label.length === 0) return false;
  if (!validCenter(place.center)) return false;
  if (
    place.countryCode !== undefined &&
    (typeof place.countryCode !== 'string' || !/^[a-z]{2}$/.test(place.countryCode))
  ) {
    return false;
  }
  return place.boundingBox === undefined || validBoundingBox(place.boundingBox);
}

/** Explicit same-origin place search; no keystroke-triggered upstream traffic. */
export async function searchPlaces(
  query: string,
  options: { signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<PlaceResult[]> {
  const response = await (options.fetcher ?? fetch)(
    `/api/places?q=${encodeURIComponent(query.trim())}`,
    { signal: options.signal },
  );
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = (payload as PlaceSearchError | undefined)?.error;
    throw new Error(
      typeof message === 'string' ? message : `Place search failed (${response.status}).`,
    );
  }
  const results =
    payload && typeof payload === 'object' ? (payload as { results?: unknown }).results : undefined;
  if (!Array.isArray(results) || !results.every(validPlaceResult)) {
    throw new Error('Place search returned an invalid response.');
  }
  return results;
}
