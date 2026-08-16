import { describe, expect, it } from 'vitest';
import { createFeatureBuildOperationCounts } from '../../src/render/feature-build-operation-counts';

describe('feature build operation counts', () => {
  it('starts every deterministic renderer counter at zero', () => {
    expect(createFeatureBuildOperationCounts()).toMatchObject({
      featureCollectionBuildCount: 0,
      featureTopologyWayVisitCount: 0,
      featureServiceWayVisitCount: 0,
      featurePhysicalStationVisitCount: 0,
      featureLaneGeometryBuildCount: 0,
      featureTierTransitionCount: 0,
    });
  });
});
