import type { LngLat } from './bounds';

export interface GeographicPolygon {
  outer: readonly [LngLat, LngLat, LngLat, LngLat, ...LngLat[]];
  holes: readonly (readonly [LngLat, LngLat, LngLat, LngLat, ...LngLat[]])[];
}

export type GeographicCoverage =
  | { kind: 'unknown' }
  | {
      kind: 'known';
      polygons: readonly [GeographicPolygon, ...GeographicPolygon[]];
    };
