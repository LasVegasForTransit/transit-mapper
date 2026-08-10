import { describe, expect, it } from 'vitest';
import { parsePlaceResults } from '../../src/model/geocode';

describe('parsePlaceResults', () => {
  it('resolves an upstream result to a center, validated bounds, and country code', () => {
    expect(
      parsePlaceResults([
        {
          display_name: 'Las Vegas, Nevada, United States',
          lat: '36.1699',
          lon: '-115.1398',
          boundingbox: ['36.0', '36.3', '-115.3', '-115.0'],
          address: { country_code: 'us' },
        },
      ]),
    ).toEqual([
      {
        label: 'Las Vegas, Nevada, United States',
        center: [-115.1398, 36.1699],
        boundingBox: { south: 36, north: 36.3, west: -115.3, east: -115 },
        countryCode: 'us',
      },
    ]);
  });

  it('drops results with no usable coordinates instead of throwing', () => {
    expect(parsePlaceResults([{ display_name: 'Nowhere', lat: 'not-a-number', lon: '1' }])).toEqual(
      [],
    );
  });

  it('omits malformed or inverted bounding boxes instead of exposing invalid camera state', () => {
    const results = parsePlaceResults([
      {
        display_name: 'Bad bounds',
        lat: '36.1',
        lon: '-115.1',
        boundingbox: ['36.3', '36', 'nope', '-115'],
      },
    ]);

    expect(results).toEqual([{ label: 'Bad bounds', center: [-115.1, 36.1] }]);
  });

  it('rejects a successful payload that is not an array', () => {
    expect(() => parsePlaceResults({ results: [] })).toThrow('Invalid place-search response');
  });
});
