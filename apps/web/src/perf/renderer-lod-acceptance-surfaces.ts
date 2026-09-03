import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { projector, type Viewport } from '@transitmapper/core/render/project';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { systemSvg, type SvgRenderOptions } from '@transitmapper/core/render/svg';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import {
  lineSceneFeatures,
  projectSchemaV16LineScene,
  usesPassengerLineScene,
} from '@transitmapper/renderer/line';
import type { RendererLodAcceptanceCamera } from './renderer-lod-acceptance';

export interface RendererLodAcceptanceSurfaceRequest {
  camera: RendererLodAcceptanceCamera;
  viewMode: 'infrastructure' | 'network';
}

function acceptanceViewport(camera: RendererLodAcceptanceCamera): Viewport {
  return {
    center: [...camera.center],
    zoom: camera.zoom,
    width: camera.viewport.width,
    height: camera.viewport.height,
  };
}

export function rendererLodAcceptanceView(
  request: RendererLodAcceptanceSurfaceRequest,
): RenderViewOptions {
  const viewport = acceptanceViewport(request.camera);
  return {
    viewMode: request.viewMode,
    visibleModes: new Set(MODE_ORDER),
    visibleWayTypes: new Set(WAY_TYPE_ORDER),
    presentation: renderPresentationForViewport(viewport, {
      pixelRatio: request.camera.viewport.pixelRatio,
    }),
  };
}

/** The acceptance appendix has to compare like with like: a passenger view is
 * one stripe per Line on every other surface, so the harness resolves the same
 * Line scene the live map and the SVG export worker resolve. Infrastructure
 * stays on the per-Service projector whose physical geometry it exists to
 * show. Mirrors apps/web/src/share/svgWorkerEntry.ts. */
async function acceptancePassengerLines(
  system: TransitSystem,
  view: RenderViewOptions,
): Promise<SvgRenderOptions['passengerLines']> {
  if (!usesPassengerLineScene(view.viewMode)) return undefined;
  const scene = await projectSchemaV16LineScene({
    system,
    view,
    sceneRevision: `lod-acceptance:${system.id}:${system.updatedAt}`,
  });
  return lineSceneFeatures(scene);
}

export async function rendererLodAcceptanceSvgMarkup(
  system: TransitSystem,
  request: RendererLodAcceptanceSurfaceRequest,
): Promise<string> {
  const viewport = acceptanceViewport(request.camera);
  const view = rendererLodAcceptanceView(request);
  const passengerLines = await acceptancePassengerLines(system, view);
  return systemSvg(system, view, projector(viewport), {
    title: '',
    legend: [],
    width: viewport.width,
    height: viewport.height,
    captionedExternally: true,
    ...(passengerLines ? { passengerLines } : {}),
  });
}
