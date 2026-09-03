import { describe, expect, it } from 'vitest';
import { viewerFeatureReference } from '../../src/viewer/viewer-feature-reference';

describe('viewer feature references', () => {
  it.each([
    [
      { routeRole: 'stripe', lineId: 'line-1' },
      'tm-services',
      { source: 'document', kind: 'line', id: 'line-1' },
    ],
    [
      { serviceId: 'service-1' },
      'tm-services-hit',
      { source: 'document', kind: 'service', id: 'service-1' },
    ],
    [
      { stationId: 'station-1' },
      'tm-footprints-fill',
      { source: 'document', kind: 'station', id: 'station-1' },
    ],
    [
      { groupId: 'group-1' },
      'tm-footprints-fill',
      { source: 'document', kind: 'group', id: 'group-1' },
    ],
    [{ nodeId: 'node-1' }, 'tm-junctions', { source: 'document', kind: 'node', id: 'node-1' }],
    [{ wayId: 'way-1' }, 'tm-ways-solid', { source: 'document', kind: 'way', id: 'way-1' }],
    [{ id: 'stop-1' }, 'tm-stations', { source: 'document', kind: 'stop', id: 'stop-1' }],
    [
      { id: 'facility-1' },
      'tm-facilities',
      { source: 'document', kind: 'facility', id: 'facility-1' },
    ],
  ])('maps rendered document properties %j', (properties, layerId, expected) => {
    expect(viewerFeatureReference(properties, layerId)).toEqual(expected);
  });

  it('selects the Line, not a ServicePlan, when a feature still carries both', () => {
    expect(
      viewerFeatureReference({ lineId: 'line-1', serviceId: 'service-1' }, 'tm-services'),
    ).toEqual({ source: 'document', kind: 'line', id: 'line-1' });
  });

  it('still selects a Service from infrastructure geometry that has no Line', () => {
    expect(viewerFeatureReference({ serviceId: 'service-1' }, 'tm-services-hit')).toEqual({
      source: 'document',
      kind: 'service',
      id: 'service-1',
    });
  });

  it('ignores basemap and renderer-helper features without a document identity', () => {
    expect(viewerFeatureReference({ name: 'Main Street', class: 'road' }, 'road')).toBeUndefined();
    expect(viewerFeatureReference({ kind: 'railTie', wayId: 42 }, 'tm-rail-ties')).toBeUndefined();
  });
});
