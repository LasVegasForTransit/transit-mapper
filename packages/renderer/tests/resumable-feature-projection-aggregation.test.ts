import type { Feature, LineString, Point } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import {
  planResumableFeatureProjectionAggregation,
  type ProjectionAggregationWorkUnit,
} from '../src/resumable-feature-projection-aggregation';
import type { GeographicFeatureProjectionUnit } from '../src/resumable-feature-projection';
import { emptySystemFeatures } from '../src/system-feature-sources';

function line(id: string, hitTarget = false): Feature<LineString> {
  return {
    type: 'Feature',
    id,
    properties: hitTarget ? { hitTarget: true } : {},
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
  };
}

function part(services: Feature<LineString>[]): SystemFeatures {
  const features = emptySystemFeatures();
  features.services.features.push(...services);
  return features;
}

function unit(id: string): GeographicFeatureProjectionUnit {
  return {
    id,
    primary: { kind: 'corridor', ids: [id] },
    sourceIds: ['tm-services'],
    run: () => emptySystemFeatures(),
  };
}

function stop(id: string, coordinate: [number, number], major = false): Feature<Point> {
  return {
    type: 'Feature',
    id,
    properties: { id, major, interchange: major },
    geometry: { type: 'Point', coordinates: coordinate },
  };
}

function stopPart(stops: Feature<Point>[]): SystemFeatures {
  const features = emptySystemFeatures();
  features.stops.features.push(...stops);
  return features;
}

function stopUnit(id: string): GeographicFeatureProjectionUnit {
  return {
    id,
    primary: { kind: 'stop', ids: [id] },
    sourceIds: ['tm-stations'],
    run: () => emptySystemFeatures(),
  };
}

describe('resumable feature projection aggregation', () => {
  it('aggregates in bounded chunks and preserves visual-before-hit service order', () => {
    const units = [unit('a'), unit('b')];
    const parts = [
      part([line('visual-a'), line('hit-a', true), line('visual-b')]),
      part([line('hit-b', true), line('visual-c')]),
    ];
    const plan = planResumableFeatureProjectionAggregation({ units, parts, batchSize: 2 });

    const workUnits: ProjectionAggregationWorkUnit[] = [];
    for (let index = 0; ; index++) {
      const work = plan.units.unitAt(index);
      if (!work) break;
      workUnits.push(work);
      work.run();
    }

    expect(plan.result().services.features.map((feature) => feature.id)).toEqual([
      'visual-a',
      'visual-b',
      'visual-c',
      'hit-a',
      'hit-b',
    ]);
    expect(workUnits.every((work) => work.featureCount <= 2)).toBe(true);
  });

  it('rejects duplicate stable IDs without publishing a partial result', () => {
    const units = [unit('a'), unit('b')];
    const plan = planResumableFeatureProjectionAggregation({
      units,
      parts: [part([line('same')]), part([line('same')])],
      batchSize: 1,
    });

    expect(() => {
      for (let index = 0; ; index++) {
        const work = plan.units.unitAt(index);
        if (!work) break;
        work.run();
      }
    }).toThrow('duplicate tm-services ID same');
    expect(() => plan.result()).toThrow('Aggregation is incomplete');
  });

  it('chooses one stop per screen cell after every projection fragment arrives', () => {
    const plan = planResumableFeatureProjectionAggregation({
      units: [stopUnit('ordinary'), stopUnit('interchange')],
      parts: [
        stopPart([stop('ordinary', [-115.15, 36.14])]),
        stopPart([stop('interchange', [-115.150001, 36.140001], true)]),
      ],
      batchSize: 1,
      presentation: renderPresentationForViewport({
        center: [-115.15, 36.14],
        zoom: 20,
        width: 800,
        height: 600,
      }),
    });

    for (let index = 0; ; index++) {
      const work = plan.units.unitAt(index);
      if (!work) break;
      work.run();
    }

    expect(plan.result().stops.features.map((feature) => feature.id)).toEqual(['interchange']);
  });
});
