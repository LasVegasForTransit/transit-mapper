import type { Geometry } from 'geojson';
import { describe, expect, it } from 'vitest';
import { renderFeatureId, systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import type { RenderFeature } from '@transitmapper/core/render/render-scene';
import { ResumableRenderFeatureComparison } from '../src/scene-feature-comparison';

const sourceId = systemFeatureSourceId('tm-ways');
const featureId = renderFeatureId(sourceId, 'overview', ['comparison']);

function feature(geometry: Geometry, properties: Record<string, unknown> = {}): RenderFeature {
  return {
    type: 'Feature',
    id: featureId,
    bbox: [0, 0, 10, 10],
    properties,
    geometry,
  };
}

function compare(previous: RenderFeature, next: RenderFeature, stepsPerUnit = 2) {
  let comparedValueCount = 0;
  let comparisonUnitCount = 0;
  const comparison = new ResumableRenderFeatureComparison({
    id: 'test-feature',
    previous,
    next,
    stepsPerUnit,
    recordUnit(stepCount) {
      comparisonUnitCount += 1;
      comparedValueCount += stepCount;
    },
  });
  const ids: string[] = [];
  for (;;) {
    const work = comparison.nextWork();
    if (!work) break;
    ids.push(work.id);
    work.run();
  }
  return { equal: comparison.result(), ids, comparedValueCount, comparisonUnitCount };
}

describe('resumable render feature comparison', () => {
  it('settles equal and changed comparisons when diagnostics are disabled', () => {
    const previous = feature({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    });
    const equal = structuredClone(previous);
    const changed = structuredClone(previous);
    (changed.geometry as { coordinates: number[][] }).coordinates[1][1] = 2;

    for (const [next, expected] of [
      [equal, true],
      [changed, false],
    ] as const) {
      const comparison = new ResumableRenderFeatureComparison({
        id: 'without-counts',
        previous,
        next,
        stepsPerUnit: 1,
      });
      let unitCount = 0;
      for (;;) {
        const work = comparison.nextWork();
        if (!work) break;
        work.run();
        unitCount += 1;
        if (unitCount > 100) throw new Error('Comparison did not settle without diagnostics.');
      }
      expect(comparison.result()).toBe(expected);
    }
  });

  it('compares reordered nested properties and bbox exactly in bounded units', () => {
    const previous = feature(
      { type: 'Point', coordinates: [1, 2] },
      { first: { values: [1, 2, 3] }, second: true },
    );
    const next = {
      ...feature(
        { type: 'Point', coordinates: [1, 2] },
        { second: true, first: { values: [1, 2, 3] } },
      ),
      bbox: [0, 0, 10, 10],
    } as RenderFeature;

    const result = compare(previous, next, 1);

    expect(result.equal).toBe(true);
    expect(result.ids.length).toBeGreaterThan(10);
    expect(result.comparisonUnitCount).toBe(result.ids.length);
    expect(result.comparedValueCount).toBeGreaterThan(10);
  });

  it('detects a changed final leaf in nested properties', () => {
    const previous = feature(
      { type: 'Point', coordinates: [1, 2] },
      {
        nested: { values: Array.from({ length: 100 }, (_, index) => index) },
      },
    );
    const next = structuredClone(previous);
    const nested = next.properties?.nested as { values: number[] };
    nested.values[nested.values.length - 1] = -1;

    expect(compare(previous, next, 4).equal).toBe(false);
  });

  it('rejects cyclic property values instead of yielding forever', () => {
    const previousProperties: Record<string, unknown> = {};
    const nextProperties: Record<string, unknown> = {};
    previousProperties.self = previousProperties;
    nextProperties.self = nextProperties;
    const comparison = new ResumableRenderFeatureComparison({
      id: 'cyclic-properties',
      previous: feature({ type: 'Point', coordinates: [1, 2] }, previousProperties),
      next: feature({ type: 'Point', coordinates: [1, 2] }, nextProperties),
      stepsPerUnit: 1,
    });

    expect(() => {
      for (let index = 0; index < 100; index += 1) {
        const work = comparison.nextWork();
        if (!work) return;
        work.run();
      }
    }).toThrow('cyclic JSON-like values');
  });

  it.each<Geometry>([
    {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
      ],
    },
    {
      type: 'MultiPoint',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
    {
      type: 'MultiLineString',
      coordinates: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    },
    {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [0, 0],
          ],
        ],
      ],
    },
    {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [0, 0] },
        {
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        },
      ],
    },
  ])('detects the final changed leaf in $type geometry', (geometry) => {
    const previous = feature(geometry);
    const next = structuredClone(previous);
    let cursor: unknown = next.geometry;
    while (typeof cursor === 'object' && cursor !== null) {
      if (Array.isArray(cursor)) {
        const values: unknown[] = cursor;
        const last = values.at(-1);
        if (typeof last === 'number') {
          values[values.length - 1] = last + 1;
          break;
        }
        cursor = last;
      } else if ('geometries' in cursor) {
        cursor = cursor.geometries;
      } else if ('coordinates' in cursor) {
        cursor = cursor.coordinates;
      } else {
        throw new Error('Geometry fixture has no comparable leaf.');
      }
    }

    expect(compare(previous, next, 2).equal).toBe(false);
  });
});
