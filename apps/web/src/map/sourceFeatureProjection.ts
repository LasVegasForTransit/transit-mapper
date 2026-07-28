import {
  computeDiagramSystem,
  type DiagramLayoutOperationCounts,
} from '@transitmapper/core/model/diagramLayout';
import type { TransitSystem } from '@transitmapper/core/model/system';
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
  extends FeatureBuildOperationCounts, DiagramLayoutOperationCounts {}

export interface BuildFeaturesForSourcesOptions {
  system: TransitSystem;
  selection: Highlight;
  handleWayIds: string[];
  view: ViewOptions;
  sourceIds: readonly SystemFeatureSourceId[];
  physicalHandleStationId?: string | null;
  physicalHandleGroupId?: string | null;
  counts?: SourceFeatureProjectionCounts;
}

const FEATURE_NAME_BY_SOURCE: Record<SystemFeatureSourceId, SystemFeatureName> = {
  [SRC_WAYS]: 'ways',
  [SRC_SERVICES]: 'services',
  [SRC_STATIONS]: 'stations',
  [SRC_HANDLES]: 'handles',
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

export function buildFeaturesForSources({
  system,
  selection,
  handleWayIds,
  view,
  sourceIds,
  physicalHandleStationId = null,
  physicalHandleGroupId = null,
  counts,
}: BuildFeaturesForSourcesOptions): SystemFeatures {
  const needsDiagramLayout =
    view.viewMode === 'diagram' &&
    sourceIds.some((sourceId) => DIAGRAM_LAYOUT_SOURCES.has(sourceId));
  const renderSystem = needsDiagramLayout ? computeDiagramSystem(system, counts) : system;

  return buildFeatures(
    renderSystem,
    selection,
    handleWayIds,
    view,
    physicalHandleStationId,
    physicalHandleGroupId,
    {
      requestedFeatures: sourceIds.map((sourceId) => FEATURE_NAME_BY_SOURCE[sourceId]),
      counts,
    },
  );
}
