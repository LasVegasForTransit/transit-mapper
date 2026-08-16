import type { GeoJsonProperties } from 'geojson';

export type StaticServicePaintPass =
  'elevated' | 'solid-casing' | 'solid-fill' | 'underground-casing' | 'underground-fill';

export interface StaticServicePaint {
  color: string;
  baseOpacity: number;
  marginPx?: number;
}

export const STATIC_SERVICE_PAINT_PASSES: readonly StaticServicePaintPass[] = [
  'elevated',
  'solid-casing',
  'solid-fill',
  'underground-casing',
  'underground-fill',
];

function propertyBoolean(properties: GeoJsonProperties, key: string): boolean {
  return properties ? (properties as Record<string, unknown>)[key] === true : false;
}

function propertyText(properties: GeoJsonProperties, key: string, fallback: string): string {
  const value: unknown = properties ? (properties as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : fallback;
}

export function staticServiceIncludedInPass(
  pass: StaticServicePaintPass,
  properties: GeoJsonProperties,
): boolean {
  if (pass === 'elevated') return propertyBoolean(properties, 'elevated');
  return pass.startsWith('underground') === propertyBoolean(properties, 'underground');
}

export function staticServicePassPaint(
  pass: StaticServicePaintPass,
  properties: GeoJsonProperties,
  routeCasingColor: string,
): StaticServicePaint {
  if (pass === 'elevated') {
    return { color: routeCasingColor, baseOpacity: 0.32, marginPx: 3.5 };
  }
  if (pass.endsWith('casing')) {
    return { color: routeCasingColor, baseOpacity: 0.72, marginPx: 2.5 };
  }
  return {
    color: propertyText(properties, 'color', routeCasingColor),
    baseOpacity: 1,
  };
}
