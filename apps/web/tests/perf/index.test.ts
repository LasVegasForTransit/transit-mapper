import { describe, expect, it, vi } from 'vitest';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import {
  attachSourceUploadMeter,
  rendererPerfFeaturesAt,
  rendererPerfFeatureStatesAt,
  rendererPerfFilterSnapshot,
  rendererPerfLayerVisibility,
  rendererPerfMapScheme,
  type PerfRenderSourceBankSnapshot,
} from '../../src/perf';

interface MeterFixture {
  map: MLMap;
  source: GeoJSONSource;
  originalSetData: GeoJSONSource['setData'];
  originalUpdateData: GeoJSONSource['updateData'];
}

function createMeterFixture(): MeterFixture {
  const originalSetData: GeoJSONSource['setData'] = function setData(this: GeoJSONSource) {
    return this;
  };
  const originalUpdateData: GeoJSONSource['updateData'] = function updateData(this: GeoJSONSource) {
    return this;
  };
  const source = {
    setData: originalSetData,
    updateData: originalUpdateData,
  } as GeoJSONSource;
  const map = {
    getStyle: () => ({ sources: { stations: { type: 'geojson' } } }),
    getSource: () => source,
  } as unknown as MLMap;
  return { map, source, originalSetData, originalUpdateData };
}

describe('performance source upload meter', () => {
  it('counts full and differential source mutations once each', () => {
    const { map, source, originalSetData, originalUpdateData } = createMeterFixture();
    const meter = attachSourceUploadMeter(map);
    const collection = { type: 'FeatureCollection' as const, features: [] };

    expect(source.setData(collection)).toBe(source);
    expect(source.updateData({ add: [] })).toBe(source);
    expect(meter.count()).toBe(2);

    meter.detach();
    expect(source).toMatchObject({ setData: originalSetData, updateData: originalUpdateData });
    source.setData(collection);
    source.updateData({ add: [] });
    expect(meter.count()).toBe(2);
  });

  it('does not overwrite a source method replaced after attachment', () => {
    const { map, source, originalSetData } = createMeterFixture();
    const meter = attachSourceUploadMeter(map);
    const replacement: GeoJSONSource['updateData'] = function updateData(this: GeoJSONSource) {
      return this;
    };
    source.updateData = replacement;

    meter.detach();

    expect(source).toMatchObject({ setData: originalSetData, updateData: replacement });
  });

  it('attributes synchronous MapLibre boundary time to each source and mutation method', () => {
    const { map, source } = createMeterFixture();
    const now = vi
      .spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(12)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(23.5);
    const meter = attachSourceUploadMeter(map);

    source.setData({ type: 'FeatureCollection', features: [] });
    source.updateData({ add: [] });

    const snapshot = Reflect.get(meter, 'snapshot') as
      | (() => readonly {
          sourceId: string;
          method: 'setData' | 'updateData';
          callCount: number;
          totalDurationMs: number;
          maxDurationMs: number;
        }[])
      | undefined;
    expect(snapshot?.()).toEqual([
      {
        sourceId: 'stations',
        method: 'setData',
        callCount: 1,
        totalDurationMs: 2,
        maxDurationMs: 2,
      },
      {
        sourceId: 'stations',
        method: 'updateData',
        callCount: 1,
        totalDurationMs: 3.5,
        maxDurationMs: 3.5,
      },
    ]);
    now.mockRestore();
  });
});

describe('renderer acceptance observations', () => {
  const bankSnapshot = {
    activeBank: 'a',
    stagingBank: null,
    activeRevision: 'accepted',
    activeVisualSourceIds: ['tm-ways--bank-a', 'tm-services--bank-a'],
    activeVisualLayerIds: [
      'tm-ways-solid--bank-a',
      'tm-services-solid--bank-a',
      'tm-stations--bank-a',
    ],
    activeVisualSourceId: 'tm-ways--bank-a',
    activeHitSourceId: 'tm-hit-features--bank-a',
    activeHitLayerIds: ['tm-services-hit--bank-a'],
    activeVisualLayerId: 'tm-ways-solid--bank-a',
    activeHitLayerId: 'tm-services-hit--bank-a',
    selectedFeatureStateSourceIds: [],
    diagnostics: {
      bankedTransactionCount: 1,
      flipCount: 1,
      hiddenSourceLoadCount: 3,
      abortCount: 0,
      styleRebuildCount: 0,
      lastFlipDurationMs: 0,
      maxFlipDurationMs: 0,
      lastFlipOperationCount: 0,
      maxFlipOperationCount: 0,
      residentFeatureCountByBank: { a: 3, b: 0 },
      residentRevisionByBank: { a: 'accepted', b: null },
    },
  } satisfies PerfRenderSourceBankSnapshot;

  it('reads the applied map scheme from the retained style', () => {
    const map = {
      getPaintProperty: (_layerId: string, property: string) =>
        property === 'background-color' ? '#0c0c0c' : undefined,
    } as unknown as MLMap;

    expect(rendererPerfMapScheme(map)).toBe('dark');
  });

  it('reports stable rendered feature state at a geographic point', () => {
    const map = {
      project: () => ({ x: 120, y: 240 }),
      getLayer: () => ({}),
      queryRenderedFeatures: () => [
        { source: 'tm-ways--bank-a', id: 'way:port-mason-harbor-bridge' },
      ],
      getFeatureState: () => ({ hover: true }),
    } as unknown as MLMap;

    expect(rendererPerfFeatureStatesAt(map, bankSnapshot, [-122.456, 37.758])).toEqual([
      {
        sourceId: 'tm-ways--bank-a',
        featureId: 'way:port-mason-harbor-bridge',
        hover: true,
        selected: false,
      },
    ]);
  });

  it('reports the active-bank feature that a pointer can target', () => {
    const map = {
      project: () => ({ x: 120, y: 240 }),
      getLayer: () => ({}),
      queryRenderedFeatures: () => [
        {
          source: 'tm-stations--bank-a',
          id: 'stop:port-mason-central',
          layer: { id: 'tm-stations--bank-a' },
          properties: { id: 'port-mason-central', name: 'Central' },
        },
      ],
    } as unknown as MLMap;

    expect(rendererPerfFeaturesAt(map, bankSnapshot, [-122.456, 37.758])).toEqual([
      {
        sourceId: 'tm-stations--bank-a',
        layerId: 'tm-stations--bank-a',
        featureId: 'stop:port-mason-central',
        properties: { id: 'port-mason-central', name: 'Central' },
      },
    ]);
  });

  it('serializes the applied filters for every active bank layer', () => {
    const map = {
      getLayer: () => ({}),
      getFilter: (layerId: string) => ['==', ['get', 'layer'], layerId],
    } as unknown as MLMap;

    expect(rendererPerfFilterSnapshot(map, bankSnapshot)).toEqual([
      {
        layerId: 'tm-services-hit--bank-a',
        filter: ['==', ['get', 'layer'], 'tm-services-hit--bank-a'],
      },
      {
        layerId: 'tm-services-solid--bank-a',
        filter: ['==', ['get', 'layer'], 'tm-services-solid--bank-a'],
      },
      {
        layerId: 'tm-stations--bank-a',
        filter: ['==', ['get', 'layer'], 'tm-stations--bank-a'],
      },
      {
        layerId: 'tm-ways-solid--bank-a',
        filter: ['==', ['get', 'layer'], 'tm-ways-solid--bank-a'],
      },
    ]);
  });

  it('reports whether each active-bank layer can contribute to a hit test', () => {
    const map = {
      getLayer: () => ({}),
      getLayoutProperty: (layerId: string, property: string) =>
        property === 'visibility' && layerId === 'tm-stations--bank-a' ? 'none' : 'visible',
    } as unknown as MLMap;

    expect(rendererPerfLayerVisibility(map, bankSnapshot)).toContainEqual({
      layerId: 'tm-stations--bank-a',
      visibility: 'none',
    });
  });
});
