import { createRenderTierStateResolver } from '@transitmapper/core/render/render-presentation';
import {
  createOrderedSystemRenderVisuals,
  type SystemFeatureSourceMap,
} from '@transitmapper/core/render/system-render-scene';
import { systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { SRC_SERVICE_ARROWS, SRC_SERVICES } from '../layers/constants';
import {
  lineSceneFeatures,
  projectSchemaV16LineScene,
  usesPassengerLineScene,
} from '../line/line-scene';
import { projectPatternOverlay } from '../projection/pattern-overlay-projection';
import { buildFeaturesForSources } from '../projection/source-feature-projection';
import { createSourceFeatureProjectionCounts } from '../projection/feature-projection-counts';
import type {
  FeatureProjectionWorkerEvent,
  FeatureProjectionWorkerRequest,
} from './feature-projection-worker-protocol';
import { createRetainedProjectionSystems } from './retained-projection-systems';
import { createRunningProjections } from './running-projections';

interface FeatureProjectionWorkerScope {
  onmessage: ((event: MessageEvent<FeatureProjectionWorkerRequest>) => void) | null;
  postMessage(event: FeatureProjectionWorkerEvent): void;
}

const workerScope = globalThis as unknown as FeatureProjectionWorkerScope;
const tierStateResolver = createRenderTierStateResolver();
const retainedSystems = createRetainedProjectionSystems();
const runningProjections = createRunningProjections();

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
  // Cancellation is handled on the dispatch turn itself, so a projection
  // suspended at a checkpoint observes the abort the moment it resumes.
  if (request.kind === 'cancel') {
    runningProjections.cancel(request.requestId);
    return;
  }
  void project(request, runningProjections.begin(request.requestId));
};

/** The single gate every reply passes through. A cancelled request must never
 * publish, and the host has stopped waiting for its failure too, so the error
 * reply is withheld on the same rule rather than a parallel one. */
function reply(event: FeatureProjectionWorkerEvent): void {
  if (!runningProjections.finish(event.requestId)) return;
  workerScope.postMessage(event);
}

async function project(
  request: Exclude<FeatureProjectionWorkerRequest, { kind: 'cancel' }>,
  signal: AbortSignal,
): Promise<void> {
  try {
    if (request.kind === 'project-pattern-overlay') {
      const { system: carried, ...overlayFacts } = request.input;
      // No `await` separates this from the message that asked for it, so a
      // cancel cannot land mid-overlay. `reply` still decides whether to send,
      // which keeps "a cancelled request never publishes" one rule instead of
      // a claim about this branch's control flow.
      const overlay = projectPatternOverlay({
        ...overlayFacts,
        system: retainedSystems.resolve(carried, 'system'),
        view: { ...request.input.view, tierStateResolver },
      });
      reply({
        kind: 'pattern-overlay-done',
        requestId: request.requestId,
        overlay,
      });
      return;
    }
    // Both slots are read before the first `await` below. Two projections can
    // interleave in one worker, and the later one may retain a newer document
    // while this one is still suspended.
    //
    // Cancellation must not skip this either. The slot the request carried is
    // what the *next* request will name, so a cancelled projection still owes
    // the realm its retention: bailing out early here would leave the client
    // naming a System this worker never took.
    const {
      system: carriedSystem,
      diagramSystem: carriedDiagramSystem,
      ...projectionFacts
    } = request.input;
    const system = retainedSystems.resolve(carriedSystem, 'system');
    const diagramSystem = carriedDiagramSystem
      ? retainedSystems.resolve(carriedDiagramSystem, 'diagramSystem')
      : undefined;
    const counts = createSourceFeatureProjectionCounts();
    const passengerLineScene = usesPassengerLineScene(request.input.view.viewMode);
    const sourceIds = passengerLineScene
      ? request.input.sourceIds.filter(
          (sourceId) => sourceId !== SRC_SERVICES && sourceId !== SRC_SERVICE_ARROWS,
        )
      : request.input.sourceIds;
    let projected = buildFeaturesForSources({
      ...projectionFacts,
      system,
      diagramSystem,
      sourceIds,
      view: { ...request.input.view, tierStateResolver },
      counts,
    });
    if (passengerLineScene && request.input.sourceIds.includes(SRC_SERVICES)) {
      // The only phase of a projection that can be stopped part-way. The
      // provider yields to the host between chunks and rechecks the signal at
      // each checkpoint, whereas `buildFeaturesForSources` above runs to
      // completion in one turn whatever the signal says.
      const lineSceneStartedAt = performance.now();
      const lineScene = await projectSchemaV16LineScene({
        system: diagramSystem ?? system,
        layout: diagramSystem ? 'diagram' : 'authored',
        view: request.input.view,
        sceneRevision: request.input.sceneRevision ?? `line:${system.id}:${request.requestId}`,
        signal,
      });
      counts.passengerLineSceneCount += 1;
      counts.passengerLineSceneDurationMs += performance.now() - lineSceneStartedAt;
      projected = { ...projected, services: lineSceneFeatures(lineScene) };
    }
    if (passengerLineScene && request.input.sourceIds.includes(SRC_SERVICE_ARROWS)) {
      projected = {
        ...projected,
        serviceArrows: { type: 'FeatureCollection', features: [] },
      };
    }
    const features = request.input.normalizeVisualScene
      ? createOrderedSystemRenderVisuals({
          revision: request.input.sceneRevision ?? `static:${system.id}`,
          features: projected,
          sourceIds: WORKER_VISUAL_SOURCE_IDS,
        }).features
      : projected;
    reply({ kind: 'done', requestId: request.requestId, features, counts });
  } catch (error) {
    reply({
      kind: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : 'Feature projection Worker failed.',
    });
  }
}
