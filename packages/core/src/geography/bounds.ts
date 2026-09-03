export type LngLat = readonly [longitude: number, latitude: number];

export type GeographicBounds =
  | { kind: 'ordinary'; west: number; south: number; east: number; north: number }
  | {
      kind: 'crosses-antimeridian';
      west: number;
      south: number;
      east: number;
      north: number;
    };
