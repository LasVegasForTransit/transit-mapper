import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { projector, type Viewport } from '@transitmapper/core/render/project';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { systemSvg } from '@transitmapper/core/render/svg';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { RendererLodAcceptanceCamera } from './renderer-lod-acceptance';

export interface RendererLodAcceptanceSurfaceRequest {
  camera: RendererLodAcceptanceCamera;
  viewMode: 'infrastructure' | 'network';
}

export function rendererLodAcceptanceView(
  request: RendererLodAcceptanceSurfaceRequest,
): RenderViewOptions {
  const viewport: Viewport = {
    center: [...request.camera.center],
    zoom: request.camera.zoom,
    width: request.camera.viewport.width,
    height: request.camera.viewport.height,
  };
  return {
    viewMode: request.viewMode,
    visibleModes: new Set(MODE_ORDER),
    visibleWayTypes: new Set(WAY_TYPE_ORDER),
    presentation: renderPresentationForViewport(viewport, {
      pixelRatio: request.camera.viewport.pixelRatio,
    }),
  };
}

export function rendererLodAcceptanceSvgMarkup(
  system: TransitSystem,
  request: RendererLodAcceptanceSurfaceRequest,
): string {
  const viewport: Viewport = {
    center: [...request.camera.center],
    zoom: request.camera.zoom,
    width: request.camera.viewport.width,
    height: request.camera.viewport.height,
  };
  return systemSvg(system, rendererLodAcceptanceView(request), projector(viewport), {
    title: '',
    legend: [],
    width: viewport.width,
    height: viewport.height,
    captionedExternally: true,
  });
}
