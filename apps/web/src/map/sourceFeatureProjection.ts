import {
  computeDiagramSystem,
  type DiagramLayoutOperationCounts,
} from '@transitmapper/core/model/diagramLayout';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { featureCollectionStats } from '@transitmapper/core/render/feature-stats';
import {
  buildFeatures,
  createFeatureBuildOperationCounts,
  type FeatureBuildOperationCounts,
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
} from './layers';
import type { SystemFeatureSourceId } from './sourceUploadPlan';
import { SYSTEM_FEATURE_NAME_BY_SOURCE } from './system-feature-sources';

export interface SourceFeatureProjectionCounts
  extends FeatureBuildOperationCounts, DiagramLayoutOperationCounts {
  rendererCandidateFeatureCount: number;
  rendererGeneratedFeatureCount: number;
  rendererGeneratedVertexCount: number;
}

/** Creates one isolated projection counter set. Cooperative generations and
 * synchronous editor refreshes must never mutate the same object because
 * their lifetimes can overlap across yielded frames. */
export function createSourceFeatureProjectionCounts(): SourceFeatureProjectionCounts {
  return {
    ...createFeatureBuildOperationCounts(),
    diagramTopologyBuildCount: 0,
    diagramTopologyCacheHitCount: 0,
    diagramStationBuildCount: 0,
    diagramStationCacheHitCount: 0,
    rendererCandidateFeatureCount: 0,
    rendererGeneratedFeatureCount: 0,
    rendererGeneratedVertexCount: 0,
  };
}

const SOURCE_FEATURE_PROJECTION_COUNT_KEYS = Object.keys(
  createSourceFeatureProjectionCounts(),
) as Array<keyof SourceFeatureProjectionCounts>;

function addProjectionCount(
  target: SourceFeatureProjectionCounts,
  source: SourceFeatureProjectionCounts,
  key: keyof SourceFeatureProjectionCounts,
): void {
  target[key] += source[key];
}

/** Adds one privately completed physical attempt to its logical generation.
 * Failed and canceled attempts never call this helper. */
export function mergeSourceFeatureProjectionCounts(
  target: SourceFeatureProjectionCounts,
  source: SourceFeatureProjectionCounts,
): void {
  for (const key of SOURCE_FEATURE_PROJECTION_COUNT_KEYS) {
    addProjectionCount(target, source, key);
  }
}

export interface BuildFeaturesForSourcesOptions {
  system: TransitSystem;
  selection: Highlight;
  handleWayIds: string[];
  view: RenderViewOptions;
  sourceIds: readonly SystemFeatureSourceId[];
  projectionScope?: RenderProjectionScope;
  unitScope?: RenderFeatureProjectionUnitScope;
  precomputedViewportCandidates?: RenderViewportCandidateSets;
  preparedSnapshot?: RenderPreparedSnapshot;
  selectionOwnedConnectors?: boolean;
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
  selection,
  handleWayIds,
  view,
  sourceIds,
  projectionScope,
  unitScope,
  precomputedViewportCandidates,
  preparedSnapshot,
  selectionOwnedConnectors,
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
  const renderSystem = needsDiagramLayout ? computeDiagramSystem(system, counts) : system;

  const features = buildFeatures(
    renderSystem,
    selection,
    handleWayIds,
    view,
    physicalHandleStationId,
    physicalHandleGroupId,
    {
      requestedFeatures: sourceIds.map((sourceId) => SYSTEM_FEATURE_NAME_BY_SOURCE[sourceId]),
      stationIds,
      projectionScope,
      unitScope,
      precomputedViewportCandidates,
      preparedSnapshot,
      selectionOwnedConnectors,
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
