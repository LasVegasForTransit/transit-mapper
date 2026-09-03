import { describe, expect, it } from 'vitest';
import type { GeographicBounds, LngLat } from '../../../src/geography/bounds';
import type { GeographicCoverage } from '../../../src/geography/coverage';
import type { MapPresentation } from '../../../src/presentation/map-presentation';

describe('query geography and presentation', () => {
  it('distinguishes ordinary bounds from an antimeridian crossing', () => {
    const bounds = [
      { kind: 'ordinary', west: -125, south: 24, east: -66, north: 49 },
      { kind: 'crosses-antimeridian', west: 170, south: -20, east: -170, north: 20 },
    ] as const satisfies readonly GeographicBounds[];

    expect(bounds.map((value) => value.kind)).toEqual(['ordinary', 'crosses-antimeridian']);
  });

  it('represents known polygons independently from unknown geographic coverage', () => {
    const outer = [
      [-115.3, 35.9],
      [-114.9, 35.9],
      [-114.9, 36.4],
      [-115.3, 36.4],
      [-115.3, 35.9],
    ] as const satisfies readonly [LngLat, LngLat, LngLat, LngLat, ...LngLat[]];
    const coverage = [
      { kind: 'unknown' },
      { kind: 'known', polygons: [{ outer, holes: [] }] },
    ] as const satisfies readonly GeographicCoverage[];

    expect(coverage[0].kind).toBe('unknown');
    expect(coverage[1].polygons[0].outer[0]).toEqual(coverage[1].polygons[0].outer.at(-1));
  });

  it('keeps camera and representation choices in map presentation', () => {
    const presentation = {
      camera: {
        center: [-115.1728, 36.1147],
        zoom: 10,
        bearing: 0,
        pitch: 0,
      },
      representationId: 'network',
    } as const satisfies MapPresentation;

    expect(presentation.camera.center).toEqual([-115.1728, 36.1147]);
    expect(presentation.representationId).toBe('network');
  });
});
