import type { FeatureCollection, LineString } from 'geojson';
import { projector } from '@transitmapper/core/render/project';
import { systemSvg, type SvgRenderOptions } from '@transitmapper/core/render/svg';
import {
  lineSceneFeatures,
  projectSchemaV16LineScene,
  usesPassengerLineScene,
} from '@transitmapper/renderer/line';
import type { SvgWorkerEvent, SvgWorkerRequest } from './svgWorkerProtocol';
import { groundPlaneProjector } from './svg-worker-projector';

export interface SvgRenderWorkerScope {
  onmessage: ((event: MessageEvent<SvgWorkerRequest>) => void) | null;
  postMessage(message: SvgWorkerEvent): void;
}

/** Network and Diagram export the passenger Lines the live map paints, so an
 * exported drawing shows one stripe per Line rather than one per ServicePlan.
 * Infrastructure keeps the physical per-Service geometry it is there to show. */
async function passengerLinesFor(
  request: SvgWorkerRequest,
): Promise<FeatureCollection<LineString> | null> {
  if (!usesPassengerLineScene(request.view.viewMode)) return null;
  const scene = await projectSchemaV16LineScene({
    system: request.system,
    view: request.view,
    sceneRevision: `svg:${request.system.id}:${request.system.updatedAt}`,
  });
  return lineSceneFeatures(scene);
}

async function render(scope: SvgRenderWorkerScope, request: SvgWorkerRequest): Promise<void> {
  try {
    const project = request.projection
      ? groundPlaneProjector(request.projection)
      : projector(request.viewport);
    const passengerLines = await passengerLinesFor(request);
    const options: SvgRenderOptions = passengerLines
      ? { ...request.options, passengerLines }
      : request.options;
    scope.postMessage({
      kind: 'done',
      markup: systemSvg(request.system, request.view, project, options),
    });
  } catch (error) {
    scope.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : 'SVG rendering failed.',
    });
  }
}

export function installSvgRenderWorker(scope: SvgRenderWorkerScope): void {
  scope.onmessage = (event) => {
    void render(scope, event.data);
  };
}

installSvgRenderWorker(globalThis);
