import type { GeoJsonProperties, Position } from 'geojson';
import type { LngLat } from '../model/system';

export type StaticVisualTier = 'overview' | 'district' | 'street';

export function numeric(properties: GeoJsonProperties, key: string, fallback: number): number {
  const value: unknown = properties ? (properties as Record<string, unknown>)[key] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function boolean(properties: GeoJsonProperties, key: string): boolean {
  return properties ? (properties as Record<string, unknown>)[key] === true : false;
}

export function text(properties: GeoJsonProperties, key: string, fallback: string): string {
  const value: unknown = properties ? (properties as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : fallback;
}

export function tier(properties: GeoJsonProperties): StaticVisualTier | undefined {
  const value: unknown = properties
    ? (properties as Record<string, unknown>).renderTier
    : undefined;
  return value === 'overview' || value === 'district' || value === 'street' ? value : undefined;
}

export function tierOpacity(properties: GeoJsonProperties): number {
  return Math.max(0, Math.min(1, numeric(properties, 'tierOpacity', 1)));
}

function hasProperty(properties: GeoJsonProperties, key: string): boolean {
  return properties !== null && Object.hasOwn(properties, key);
}

function lowerTierOpacity(baseOpacity: number, upperWeight: number): number {
  if (upperWeight <= 0) return baseOpacity;
  if (upperWeight >= 1) return 0;
  return (baseOpacity * (1 - upperWeight)) / (1 - baseOpacity * upperWeight);
}

function interpolatedWeight(value: number, lower: number, upper: number): number {
  return Math.max(0, Math.min(1, (value - lower) / (upper - lower)));
}

function hasTierAvailabilityContract(properties: GeoJsonProperties): boolean {
  return ['projectedWidthPx', 'hasOverviewTier', 'hasDistrictTier', 'hasStreetTier'].every((key) =>
    hasProperty(properties, key),
  );
}

/** Resolve the opacity MapLibre would paint after combining the current tier
 * with its adjacent transition. Static surfaces use this rather than trying
 * to interpret a MapLibre expression at serialization time. */
export function resolvedPaintOpacity(properties: GeoJsonProperties, baseOpacity: number): number {
  const resolvedTier = tier(properties);
  if (!resolvedTier || !hasProperty(properties, 'corridorW14')) {
    return baseOpacity * tierOpacity(properties);
  }
  const projectedWidth = numeric(properties, 'projectedWidthPx', 0);
  if (!hasTierAvailabilityContract(properties)) return baseOpacity * tierOpacity(properties);
  const hasOverview = boolean(properties, 'hasOverviewTier');
  const hasDistrict = boolean(properties, 'hasDistrictTier');
  const hasStreet = boolean(properties, 'hasStreetTier');

  if (resolvedTier === 'overview') {
    if (!hasDistrict) return baseOpacity;
    return lowerTierOpacity(baseOpacity, interpolatedWeight(projectedWidth, 2, 4));
  }
  if (resolvedTier === 'street') {
    if (!hasDistrict) return baseOpacity;
    return baseOpacity * interpolatedWeight(projectedWidth, 9, 12);
  }
  if (!hasOverview && projectedWidth < 4) return baseOpacity;
  if (!hasStreet && projectedWidth > 9) return baseOpacity;
  if (projectedWidth < 4) {
    return baseOpacity * interpolatedWeight(projectedWidth, 2, 4);
  }
  if (projectedWidth > 9) {
    return lowerTierOpacity(baseOpacity, interpolatedWeight(projectedWidth, 9, 12));
  }
  return baseOpacity;
}

export function scaledMetricWidth(w14: number, zoom: number): number {
  return w14 * 2 ** (zoom - 14);
}

export function lngLatPath(coordinates: Position[]): LngLat[] {
  return coordinates.map((coordinate) => {
    if (coordinate.length < 2) {
      throw new Error('Static visual geometry requires two-dimensional coordinates.');
    }
    const [lng, lat] = coordinate;
    return [lng, lat];
  });
}
