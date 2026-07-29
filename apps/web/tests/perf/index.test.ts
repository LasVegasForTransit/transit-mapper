import { describe, expect, it } from 'vitest';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import { attachSourceUploadMeter } from '../../src/perf';

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
    expect(source.setData).toBe(originalSetData);
    expect(source.updateData).toBe(originalUpdateData);
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

    expect(source.setData).toBe(originalSetData);
    expect(source.updateData).toBe(replacement);
  });
});
