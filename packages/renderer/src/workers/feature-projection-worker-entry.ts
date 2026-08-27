import { createRenderTierStateResolver } from '@transitmapper/core/render/render-presentation';
import {
  createOrderedSystemRenderVisuals,
  type SystemFeatureSourceMap,
} from '@transitmapper/core/render/system-render-scene';
import { systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { buildFeaturesForSources } from '../sourceFeatureProjection';
import { createSourceFeatureProjectionCounts } from '../feature-projection-counts';
import type {
  FeatureProjectionWorkerEvent,
  FeatureProjectionWorkerRequest,
} from './feature-projection-worker-protocol';

interface FeatureProjectionWorkerScope {
  onmessage: ((event: MessageEvent<FeatureProjectionWorkerRequest>) => void) | null;
  postMessage(event: FeatureProjectionWorkerEvent): void;
}

const workerScope = globalThis as unknown as FeatureProjectionWorkerScope;
const tierStateResolver = createRenderTierStateResolver();

// Static callers ask the worker for only ordered visual collections. The
// temporary source names below never leave this worker: their sole purpose is
// to let core validate one complete RenderScene before its visual half is
// returned. Keeping this mapping local prevents a read-only preview from
// pulling the editor's MapLibre source-bank registry into the main bundle.
const WORKER_VISUAL_SOURCE_IDS: SystemFeatureSourceMap = {
  ways: systemFeatureSourceId('worker-ways'),
  services: systemFeatureSourceId('worker-services'),
  stops: systemFeatureSourceId('worker-stations'),
  handles: systemFeatureSourceId('worker-handles'),
  serviceTermini: systemFeatureSourceId('worker-service-termini'),
  footprints: systemFeatureSourceId('worker-footprints'),
  platforms: systemFeatureSourceId('worker-platforms'),
  facilities: systemFeatureSourceId('worker-facilities'),
  physicalHandles: systemFeatureSourceId('worker-physical-handles'),
  lanes: systemFeatureSourceId('worker-lanes'),
  laneMarkings: systemFeatureSourceId('worker-lane-markings'),
  laneArrows: systemFeatureSourceId('worker-lane-arrows'),
  serviceArrows: systemFeatureSourceId('worker-service-arrows'),
  junctions: systemFeatureSourceId('worker-junctions'),
  connectors: systemFeatureSourceId('worker-connectors'),
  wayLabels: systemFeatureSourceId('worker-way-labels'),
};

/** The worker holds live tier hysteresis beside the expensive geometry work.
 * That avoids passing a function across `postMessage` while retaining the
 * same per-document, per-corridor 3/2 and 12/9 behavior. */
workerScope.onmessage = (event) => {
  const request = event.data;
  try {
    const counts = createSourceFeatureProjectionCounts();
    const projected = buildFeaturesForSources({
      ...request.input,
      view: { ...request.input.view, tierStateResolver },
      counts,
    });
    const features = request.input.normalizeVisualScene
      ? createOrderedSystemRenderVisuals({
          revision: request.input.sceneRevision ?? `static:${request.input.system.id}`,
          features: projected,
          sourceIds: WORKER_VISUAL_SOURCE_IDS,
        }).features
      : projected;
    workerScope.postMessage({ kind: 'done', requestId: request.requestId, features, counts });
  } catch (error) {
    workerScope.postMessage({
      kind: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'Feature projection Worker failed.',
    });
  }
};
