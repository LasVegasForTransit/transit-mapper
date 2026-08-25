import { computeDiagramSystem } from '@transitmapper/core/model/diagramLayout';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { featureCollectionStats } from '@transitmapper/core/render/feature-stats';
import {
  buildFeatures,
  type Highlight,
  type RenderViewOptions,
  type SystemFeatures,
} from '@transitmapper/core/render/buildFeatures';
import type { RenderProjectionScope } from '@transitmapper/core/render/render-projection-scope';
import type { RenderFeatureProjectionUnitScope } from '@transitmapper/core/render/render-feature-projection-unit';
import type { RenderViewportCandidateSets } from '@transitmapper/core/render/render-viewport-candidates';
import type { RenderPreparedSnapshot } from '@transitmapper/core/render/render-preparation';
import {
  SRC_HANDLES,
  SRC_LANE_ARROWS,
  SRC_SERVICE_ARROWS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAYS,
} from './layers/constants';
import type { SystemFeatureSourceId } from './sourceUploadPlan';
import { SYSTEM_FEATURE_NAME_BY_SOURCE } from './system-feature-sources';
import type { SourceFeatureProjectionCounts } from './feature-projection-counts';

export {
  createSourceFeatureProjectionCounts,
  type SourceFeatureProjectionCounts,
} from './feature-projection-counts';

export interface BuildFeaturesForSourcesOptions {
  system: TransitSystem;
  /** A worker-produced schematic snapshot. Diagram projection receives this
   * instead of solving layout again on the MapLibre/main-thread boundary. */
  diagramSystem?: TransitSystem;
  selection: Highlight;
  handleWayIds: string[];
  view: RenderViewOptions;
  sourceIds: readonly SystemFeatureSourceId[];
  projectionScope?: RenderProjectionScope;
  unitScope?: RenderFeatureProjectionUnitScope;
  precomputedViewportCandidates?: RenderViewportCandidateSets;
  preparedSnapshot?: RenderPreparedSnapshot;
  selectionOwnedConnectors?: boolean;
  stopIds?: readonly string[];
  /** Physical passenger places are separate from boarding-point stops. */
  stationIds?: readonly string[];
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

function candidateVisitCount(counts: SourceFeatureProjectionCounts): number {
  return (
    counts.featureTopologyWayVisitCount +
    counts.featureServiceWayVisitCount +
    counts.featureJunctionNodeVisitCount +
    counts.featureStopVisitCount +
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
}

function recordProjectionDimensions({
  counts,
  candidateVisitsBefore,
  features,
  sourceIds,
}: RecordProjectionDimensionsOptions): void {
  const output = featureCollectionStats(
    sourceIds.map((sourceId) => features[SYSTEM_FEATURE_NAME_BY_SOURCE[sourceId]]),
  );
  counts.rendererCandidateFeatureCount += candidateVisitCount(counts) - candidateVisitsBefore;
  counts.rendererGeneratedFeatureCount += output.featureCount;
  counts.rendererGeneratedVertexCount += output.vertexCount;
}

export function buildFeaturesForSources({
  system,
  diagramSystem,
  selection,
  handleWayIds,
  view,
  sourceIds,
  projectionScope,
  unitScope,
  precomputedViewportCandidates,
  preparedSnapshot,
  selectionOwnedConnectors,
  stopIds,
  stationIds,
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
  const renderSystem =
    diagramSystem ?? (needsDiagramLayout ? computeDiagramSystem(system, counts) : system);

  const features = buildFeatures(
    renderSystem,
    selection,
    handleWayIds,
    view,
    physicalHandleStationId,
    physicalHandleGroupId,
    {
      requestedFeatures: sourceIds.map((sourceId) => SYSTEM_FEATURE_NAME_BY_SOURCE[sourceId]),
      stopIds,
      stationIds,
      projectionScope,
      unitScope,
      precomputedViewportCandidates,
      preparedSnapshot,
      selectionOwnedConnectors,
      // A resumable projection owns only one fragment. Applying density here
      // would make the surviving marker depend on arbitrary batch boundaries.
      // The aggregation stage applies the same core policy after every source
      // candidate is present.
      applyScreenDensity: unitScope === undefined,
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
    });
  }
  return features;
}
