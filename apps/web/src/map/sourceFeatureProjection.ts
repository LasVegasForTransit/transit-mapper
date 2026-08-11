import {
  computeDiagramSystem,
  type DiagramLayoutOperationCounts,
} from '@transitmapper/core/model/diagramLayout';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { featureCollectionStats } from '@transitmapper/core/render/feature-stats';
import {
  buildFeatures,
  type FeatureBuildOperationCounts,
  type Highlight,
  type SystemFeatureName,
  type SystemFeatures,
  type ViewOptions,
} from '@transitmapper/core/render/buildFeatures';
import {
  SRC_CONNECTORS,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_HANDLES,
  SRC_SERVICE_TERMINI,
  SRC_JUNCTIONS,
  SRC_LANE_ARROWS,
  SRC_LANE_MARKINGS,
  SRC_LANES,
  SRC_PHYSICAL_HANDLES,
  SRC_PLATFORMS,
  SRC_SERVICE_ARROWS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAY_LABELS,
  SRC_WAYS,
} from './layers';
import type { SystemFeatureSourceId } from './sourceUploadPlan';

export interface SourceFeatureProjectionCounts
  extends FeatureBuildOperationCounts, DiagramLayoutOperationCounts {
  rendererCandidateFeatureCount: number;
  rendererGeneratedFeatureCount: number;
  rendererGeneratedVertexCount: number;
}

export interface BuildFeaturesForSourcesOptions {
  system: TransitSystem;
  selection: Highlight;
  handleWayIds: string[];
  view: ViewOptions;
  sourceIds: readonly SystemFeatureSourceId[];
  stopIds?: readonly string[];
  physicalHandleStationId?: string | null;
  physicalHandleGroupId?: string | null;
  activePatternId?: string | null;
  armedTerminus?: {
    serviceId: string;
    patternId: string;
    side: 'start' | 'end';
  } | null;
  counts?: SourceFeatureProjectionCounts;
}

const FEATURE_NAME_BY_SOURCE: Record<SystemFeatureSourceId, SystemFeatureName> = {
  [SRC_WAYS]: 'ways',
  [SRC_SERVICES]: 'services',
  [SRC_STATIONS]: 'stops',
  [SRC_HANDLES]: 'handles',
  [SRC_SERVICE_TERMINI]: 'serviceTermini',
  [SRC_FOOTPRINTS]: 'footprints',
  [SRC_PLATFORMS]: 'platforms',
  [SRC_FACILITIES]: 'facilities',
  [SRC_PHYSICAL_HANDLES]: 'physicalHandles',
  [SRC_LANES]: 'lanes',
  [SRC_LANE_MARKINGS]: 'laneMarkings',
  [SRC_LANE_ARROWS]: 'laneArrows',
  [SRC_SERVICE_ARROWS]: 'serviceArrows',
  [SRC_JUNCTIONS]: 'junctions',
  [SRC_CONNECTORS]: 'connectors',
  [SRC_WAY_LABELS]: 'wayLabels',
};

/** Only these Diagram collections consume schematic coordinates. Physical
 * planning collections are deliberately empty outside Infrastructure view,
 * so a facility/group edit in Diagram must not wake the layout solver. */
const DIAGRAM_LAYOUT_SOURCES = new Set<SystemFeatureSourceId>([
  SRC_WAYS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_HANDLES,
  SRC_LANE_ARROWS,
  SRC_SERVICE_ARROWS,
]);

const SERVICE_CANDIDATE_SOURCES = new Set<SystemFeatureSourceId>([
  SRC_WAYS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_SERVICE_TERMINI,
  SRC_LANES,
  SRC_LANE_MARKINGS,
  SRC_LANE_ARROWS,
  SRC_SERVICE_ARROWS,
]);

function candidateVisitCount(counts: SourceFeatureProjectionCounts): number {
  return (
    counts.featureTopologyWayVisitCount +
    counts.featureJunctionNodeVisitCount +
    counts.featureStationVisitCount +
    counts.featureHandleWayVisitCount +
    counts.featurePhysicalStationVisitCount +
    counts.featurePhysicalGroupVisitCount +
    counts.featureFacilityVisitCount +
    counts.featureNamedWayVisitCount
  );
}

interface RecordProjectionDimensionsOptions {
  counts: SourceFeatureProjectionCounts;
  candidateVisitsBefore: number;
  features: SystemFeatures;
  sourceIds: readonly SystemFeatureSourceId[];
  serviceCount: number;
}

function recordProjectionDimensions({
  counts,
  candidateVisitsBefore,
  features,
  sourceIds,
  serviceCount,
}: RecordProjectionDimensionsOptions): void {
  const output = featureCollectionStats(
    sourceIds.map((sourceId) => features[FEATURE_NAME_BY_SOURCE[sourceId]]),
  );
  const serviceCandidates = sourceIds.some((sourceId) => SERVICE_CANDIDATE_SOURCES.has(sourceId))
    ? serviceCount
    : 0;
  counts.rendererCandidateFeatureCount +=
    candidateVisitCount(counts) - candidateVisitsBefore + serviceCandidates;
  counts.rendererGeneratedFeatureCount += output.featureCount;
  counts.rendererGeneratedVertexCount += output.vertexCount;
}

export function buildFeaturesForSources({
  system,
  selection,
  handleWayIds,
  view,
  sourceIds,
  stopIds,
  physicalHandleStationId = null,
  physicalHandleGroupId = null,
  activePatternId = null,
  armedTerminus = null,
  counts,
}: BuildFeaturesForSourcesOptions): SystemFeatures {
  const candidateVisitsBefore = counts ? candidateVisitCount(counts) : 0;
  const needsDiagramLayout =
    view.viewMode === 'diagram' &&
    sourceIds.some((sourceId) => DIAGRAM_LAYOUT_SOURCES.has(sourceId));
  const renderSystem = needsDiagramLayout ? computeDiagramSystem(system, counts) : system;

  const features = buildFeatures(
    renderSystem,
    selection,
    handleWayIds,
    view,
    physicalHandleStationId,
    physicalHandleGroupId,
    {
      requestedFeatures: sourceIds.map((sourceId) => FEATURE_NAME_BY_SOURCE[sourceId]),
      stopIds,
      counts,
      activePatternId,
      armedTerminus,
    },
  );
  if (counts) {
    recordProjectionDimensions({
      counts,
      candidateVisitsBefore,
      features,
      sourceIds,
      serviceCount: system.services.length,
    });
  }
  return features;
}
