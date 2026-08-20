import { describe, expect, it } from 'vitest';
import { API_V1_PREFIX, apiV1Path } from '../../src/api/version';

describe('API version paths', () => {
  it('mounts every v1 resource below one shared prefix', () => {
    expect(API_V1_PREFIX).toBe('/api/v1');
    expect(apiV1Path('/gtfs')).toBe('/api/v1/gtfs');
    expect(apiV1Path('/future-resource/item')).toBe('/api/v1/future-resource/item');
  });
});
