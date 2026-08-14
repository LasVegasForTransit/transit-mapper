import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { projector, type Viewport } from '@transitmapper/core/render/project';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { systemSvg } from '@transitmapper/core/render/svg';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { Map as MLMap } from 'maplibre-gl';
import { addExportSourcesAndLayers, setExportFeatureData } from '../map/export/exportLayerSetup';
import { registerMapIcons } from '../map/layers';
import { localBlankStyleForScheme } from '../map/mapTheme';
import { buildFeaturesForFittedMap } from '../map/fitted-map-feature-builder';
import type { RendererLodAcceptanceCamera } from './renderer-lod-acceptance';

export interface RendererLodAcceptanceSurfaceRequest {
  camera: RendererLodAcceptanceCamera;
  viewMode: 'infrastructure' | 'network';
}

export interface RendererLodAcceptanceSurfaceSeam {
  renderStatic(request: RendererLodAcceptanceSurfaceRequest): Promise<void>;
  renderSvg(request: RendererLodAcceptanceSurfaceRequest): Promise<void>;
  clear(): void;
}

interface RendererLodAcceptanceEditorStore {
  getState(): { system: TransitSystem };
}

export interface RendererLodAcceptanceSurfaceHost extends Window {
  __editor?: RendererLodAcceptanceEditorStore;
  __rendererLodAcceptanceSurface?: RendererLodAcceptanceSurfaceSeam;
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

function nextAnimationFrame(host: Window): Promise<void> {
  return new Promise((resolve) => host.requestAnimationFrame(() => resolve()));
}

function waitForMapEvent(map: MLMap, event: 'load' | 'idle'): Promise<void> {
  return new Promise((resolve) => {
    map.once(event, () => {
      resolve();
    });
  });
}

function acceptanceSurface(
  document: Document,
  request: RendererLodAcceptanceSurfaceRequest,
): HTMLDivElement {
  const element = document.createElement('div');
  element.dataset.rendererLodAcceptanceSurface = 'true';
  Object.assign(element.style, {
    position: 'fixed',
    inset: '0 auto auto 0',
    width: `${request.camera.viewport.width}px`,
    height: `${request.camera.viewport.height}px`,
    zIndex: '2147483647',
    background: '#f7f4ec',
  });
  document.body.append(element);
  return element;
}

function defaultSystem(host: RendererLodAcceptanceSurfaceHost): TransitSystem {
  const system = host.__editor?.getState().system;
  if (!system) throw new Error('Renderer LOD acceptance requires the editor fixture store.');
  return system;
}

/** Perf-build-only read-only surfaces. Both receive the same explicit camera
 * and display size as the live acceptance frame; neither reads the document's
 * stored viewport or fits bounds behind the capture runner's back. */
export function attachRendererLodAcceptanceSurfaceHarness(
  host: RendererLodAcceptanceSurfaceHost = window,
  system: () => TransitSystem = () => defaultSystem(host),
): () => void {
  let map: MLMap | undefined;
  let surface: HTMLDivElement | undefined;
  const clear = () => {
    map?.remove();
    map = undefined;
    surface?.remove();
    surface = undefined;
  };
  host.__rendererLodAcceptanceSurface = {
    async renderStatic(request) {
      clear();
      if (host.devicePixelRatio !== request.camera.viewport.pixelRatio) {
        throw new Error(
          `Renderer LOD acceptance DPR mismatch: expected ${request.camera.viewport.pixelRatio}, got ${host.devicePixelRatio}.`,
        );
      }
      surface = acceptanceSurface(host.document, request);
      const maplibregl = (await import('maplibre-gl')).default;
      map = new maplibregl.Map({
        container: surface,
        style: localBlankStyleForScheme('light'),
        center: [...request.camera.center],
        zoom: request.camera.zoom,
        attributionControl: false,
        interactive: false,
        preserveDrawingBuffer: true,
      });
      await waitForMapEvent(map, 'load');
      registerMapIcons(map, 'light');
      addExportSourcesAndLayers(map);
      map.resize();
      map.jumpTo({ center: [...request.camera.center], zoom: request.camera.zoom });
      setExportFeatureData(
        map,
        buildFeaturesForFittedMap(system(), rendererLodAcceptanceView(request), map),
      );
      await waitForMapEvent(map, 'idle');
      await nextAnimationFrame(host);
      await nextAnimationFrame(host);
    },
    async renderSvg(request) {
      clear();
      surface = acceptanceSurface(host.document, request);
      surface.innerHTML = rendererLodAcceptanceSvgMarkup(system(), request);
      await host.document.fonts.ready;
      await nextAnimationFrame(host);
      await nextAnimationFrame(host);
    },
    clear,
  };
  return () => {
    clear();
    delete host.__rendererLodAcceptanceSurface;
  };
}

declare global {
  interface Window {
    __rendererLodAcceptanceSurface?: RendererLodAcceptanceSurfaceSeam;
  }
}
