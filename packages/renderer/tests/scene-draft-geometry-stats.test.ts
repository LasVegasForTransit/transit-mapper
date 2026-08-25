import type { Feature, Geometry, GeometryCollection, LineString, MultiPolygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { renderDomainIdentity, renderFeatureId } from '@transitmapper/core/render/render-identity';
import { SRC_WAYS } from '../src/layers/constants';
import { SYSTEM_FEATURE_SOURCE_BY_NAME } from '../src/system-feature-sources';
import { controllerFixture, emptySystemFeatures } from './support/scene-draft.test';

describe('scene draft geometry stats', () => {
  it.each([
    {
      geometryType: 'MultiPolygon',
      createGeometry: (recordRead: () => void): Geometry => {
        const coordinates: MultiPolygon['coordinates'] = Array.from({ length: 2_000 }, () => [
          [
            [0, 0],
            [1, 0],
            [0, 0],
          ],
        ]);
        return {
          type: 'MultiPolygon',
          coordinates: new Proxy(coordinates, {
            get(target, property, receiver) {
              if (typeof property === 'string' && /^\d+$/.test(property)) recordRead();
              return Reflect.get(target, property, receiver) as unknown;
            },
          }),
        };
      },
    },
    {
      geometryType: 'GeometryCollection',
      createGeometry: (recordRead: () => void): Geometry => {
        const geometries: GeometryCollection['geometries'] = Array.from(
          { length: 2_000 },
          (_, index): Geometry => ({
            type: 'LineString',
            coordinates: [
              [index, 0],
              [index + 1, 0],
            ],
          }),
        );
        return {
          type: 'GeometryCollection',
          geometries: new Proxy(geometries, {
            get(target, property, receiver) {
              if (typeof property === 'string' && /^\d+$/.test(property)) recordRead();
              return Reflect.get(target, property, receiver) as unknown;
            },
          }),
        };
      },
    },
  ])('counts one $geometryType across bounded normalization units', ({ createGeometry }) => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    let aggregateReads = 0;
    const features = emptySystemFeatures();
    features.ways.features.push({
      type: 'Feature',
      id: renderFeatureId(waysSource, 'overview', ['aggregate']),
      properties: { id: 'aggregate', renderTier: 'overview' },
      geometry: createGeometry(() => {
        aggregateReads += 1;
      }),
    } as Feature<LineString>);
    const plan = fixture.controller.draft(
      { revision: 'aggregate-normalization', features, sourceIds: [SRC_WAYS] },
      { batchSize: 1 },
    );
    let descriptorReads = 0;
    let maxUnitReads = 0;
    const ids: string[] = [];
    for (let index = 0; ; index += 1) {
      aggregateReads = 0;
      const unit = plan.units.unitAt(index);
      descriptorReads += aggregateReads;
      if (!unit) break;
      aggregateReads = 0;
      unit.run();
      maxUnitReads = Math.max(maxUnitReads, aggregateReads);
      ids.push(unit.id);
    }

    expect(descriptorReads).toBe(0);
    expect(maxUnitReads).toBeLessThanOrEqual(512);
    expect(ids.filter((id) => id.includes(':stats:')).length).toBeGreaterThan(1);
  });

  it('removes aggregate geometry from cached stats without revisiting its parts', () => {
    const fixture = controllerFixture();
    const waysSource = SYSTEM_FEATURE_SOURCE_BY_NAME.ways;
    let polygonReads = 0;
    const polygons = new Proxy(
      Array.from({ length: 2_000 }, () => [
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
      ]),
      {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^\d+$/.test(property)) polygonReads += 1;
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    const initial = emptySystemFeatures();
    initial.ways.features.push({
      type: 'Feature',
      id: renderFeatureId(waysSource, 'overview', ['removed-aggregate']),
      properties: { id: 'removed-aggregate', renderTier: 'overview' },
      geometry: { type: 'MultiPolygon', coordinates: polygons },
    } as unknown as Feature<LineString>);
    fixture.controller.applySynchronously({
      revision: 'aggregate-before-removal',
      features: initial,
      sourceIds: [SRC_WAYS],
    });
    polygonReads = 0;
    const plan = fixture.controller.draft(
      {
        revision: 'aggregate-after-removal',
        features: emptySystemFeatures(),
        sourceIds: [SRC_WAYS],
        replacementDomainsBySource: new Map([
          [SRC_WAYS, [renderDomainIdentity('way', 'removed-aggregate')]],
        ]),
      },
      { batchSize: 1 },
    );
    let maxUnitReads = 0;
    for (let index = 0; ; index += 1) {
      const unit = plan.units.unitAt(index);
      if (!unit) break;
      polygonReads = 0;
      unit.run();
      maxUnitReads = Math.max(maxUnitReads, polygonReads);
    }

    expect(maxUnitReads).toBe(0);
  });
});
