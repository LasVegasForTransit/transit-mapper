/**
 * Stable, machine-independent attribution for renderer feature construction.
 *
 * This leaf deliberately has no geometry dependencies. The main thread can
 * create and merge plain counter snapshots without accidentally loading the
 * feature builder that the projection Worker owns.
 */
export interface FeatureBuildOperationCounts {
  featureCollectionBuildCount: number;
  featureTopologyPassCount: number;
  featureTopologyWayVisitCount: number;
  /** Service-bearing way candidates visited by service paint/arrow projection. */
  featureServiceWayVisitCount: number;
  featureJunctionPassCount: number;
  featureJunctionNodeVisitCount: number;
  featureStopPassCount: number;
  featureStopVisitCount: number;
  featureHandlePassCount: number;
  featureHandleWayVisitCount: number;
  featurePhysicalPassCount: number;
  featurePhysicalStationVisitCount: number;
  featurePhysicalGroupVisitCount: number;
  featureFacilityPassCount: number;
  featureFacilityVisitCount: number;
  featureWayLabelPassCount: number;
  featureNamedWayVisitCount: number;
  featureLaneGeometryBuildCount: number;
  featureLaneGeometryCacheHitCount: number;
  featureTierTransitionCount: number;
}

export function createFeatureBuildOperationCounts(): FeatureBuildOperationCounts {
  return {
    featureCollectionBuildCount: 0,
    featureTopologyPassCount: 0,
    featureTopologyWayVisitCount: 0,
    featureServiceWayVisitCount: 0,
    featureJunctionPassCount: 0,
    featureJunctionNodeVisitCount: 0,
    featureStopPassCount: 0,
    featureStopVisitCount: 0,
    featureHandlePassCount: 0,
    featureHandleWayVisitCount: 0,
    featurePhysicalPassCount: 0,
    featurePhysicalStationVisitCount: 0,
    featurePhysicalGroupVisitCount: 0,
    featureFacilityPassCount: 0,
    featureFacilityVisitCount: 0,
    featureWayLabelPassCount: 0,
    featureNamedWayVisitCount: 0,
    featureLaneGeometryBuildCount: 0,
    featureLaneGeometryCacheHitCount: 0,
    featureTierTransitionCount: 0,
  };
}
