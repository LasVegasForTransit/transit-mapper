import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { INITIAL_STYLE_FALLBACK_TIMEOUT_MS } from '@transitmapper/map/base-style';
import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { resolveDocumentMapPresentation } from '@transitmapper/map/presentation';
import { createFeatureProjectionWorker } from '@transitmapper/renderer/projection-worker';
import type { FeatureProjectionClient } from '@transitmapper/renderer/projection-worker';
import type { SnapshotMapPresentation } from '@transitmapper/map/snapshot';
import {
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAYS,
} from '@transitmapper/renderer/layers';
import { registerMapIcons } from '../map/layers';
import { EMBED_FEATURE_SOURCES, EMBED_SOURCE_IDS, embedLayerSpecsForScheme } from './config';
import { markFirstSystemMapPaint } from '../perf/mapPaintMark';
import {
  getSystemColorScheme,
  subscribeSystemColorScheme,
  type ColorScheme,
} from '../theme/color-scheme';
import { basemapStyleForScheme, localBlankStyleForScheme } from '../map/mapTheme';
import { renderPresentationForFittedMap, type FittedMapLike } from '../map/static-render-features';
import { carryDocumentStyle } from '../map/document-style-carry';
import type { EmbedContent, EmbedMapRuntimeOptions } from './embed-bootstrap';
import { createEmbedStyleController, embedOverlayIsRetained } from './embed-style-controller';

const PERF_HARNESS_BUILD = import.meta.env.DEV || import.meta.env.VITE_PERF_BUILD === '1';

// The embedded map is a live, read-only view of one shared system. This
// runtime boundary starts after the static host shell is committed, keeping
// MapLibre and its Workers out of the host page's initial parse work.
const MAP_LOAD_TIMEOUT_MS = 20_000;
const SYSTEM_PAINT_TIMEOUT_MS = 10_000;

function createMap(
  container: HTMLElement,
  scheme: ColorScheme,
  options: EmbedMapRuntimeOptions,
): MLMap {
  const map = new maplibregl.Map({
    container,
    style: basemapStyleForScheme(scheme),
    // The real camera is fitted once the snapshot arrives. Starting the style
    // now lets its network/worker setup overlap the independent API request.
    center: [0, 0],
    zoom: 1,
    // An embed is a reading surface, not an editing one: pan and zoom are
    // welcome, rotation and pitch just let a reader get lost.
    dragRotate: false,
    pitchWithRotate: false,
    touchZoomRotate: true,
    attributionControl: { compact: true },
  });
  map.once('style.load', () => options.milestones.mapStyleReady());
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  if (PERF_HARNESS_BUILD && window.__TRANSITMAPPER_PERF_RUN__ === true) {
    const cameraSnapshot = () => {
      const center = map.getCenter();
      return { center: [center.lng, center.lat] as [number, number], zoom: map.getZoom() };
    };
    window.__perfCameraSnapshot = cameraSnapshot;
    map.on('remove', () => {
      if (window.__perfCameraSnapshot === cameraSnapshot) delete window.__perfCameraSnapshot;
    });
  }

  // An embed lives at whatever size the host page decides, and that size can
  // change after load — a responsive article column, a lazy-loaded iframe that
  // was display:none a moment ago, a reader rotating their phone. MapLibre
  // only measures its container once, at construction, and falls back to
  // 400x300 if the container had no size yet; without this the map paints into
  // a small corner of the frame forever.
  const resizeObserver = new ResizeObserver(() => map.resize());
  resizeObserver.observe(container);
  map.on('remove', () => resizeObserver.disconnect());

  // MapLibre reports style/source/layer failures through its own event, not by
  // throwing. Without this an embed that half-renders does so in total silence,
  // which is the worst possible failure mode for something running inside
  // someone else's page.
  map.on('error', (event) => console.error('[transitmapper embed]', event.error ?? event));
  return map;
}

function waitForMapLoad(map: MLMap): Promise<void> {
  if (map.loaded()) return Promise.resolve();
  return new Promise((resolvePromise, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out loading the map style.'));
    }, MAP_LOAD_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timer);
      map.off('load', onLoad);
      map.off('remove', onRemove);
    };
    const onLoad = () => {
      cleanup();
      resolvePromise();
    };
    const onRemove = () => {
      cleanup();
      reject(new Error('The map was closed before it loaded.'));
    };
    map.on('load', onLoad);
    map.on('remove', onRemove);
  });
}

function waitForSystemPaint(map: MLMap): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out drawing the system.'));
    }, SYSTEM_PAINT_TIMEOUT_MS);
    const cleanup = () => {
      window.clearTimeout(timer);
      map.off('render', onRender);
      map.off('remove', onRemove);
    };
    const onRender = () => {
      if (![...EMBED_SOURCE_IDS].every((sourceId) => map.isSourceLoaded(sourceId))) return;
      cleanup();
      resolvePromise();
    };
    const onRemove = () => {
      cleanup();
      reject(new Error('The map was closed before the system painted.'));
    };
    map.on('render', onRender);
    map.on('remove', onRemove);
    map.triggerRepaint();
  });
}

export interface EmbedSceneRequest {
  readonly projection: FeatureProjectionClient;
  readonly system: TransitSystem;
  readonly presentation: SnapshotMapPresentation;
  readonly map: FittedMapLike;
}

/**
 * Resolves the one committed scene every passenger surface shares.
 *
 * The embed must not build its own features. Only the projection worker swaps
 * the Line scene in for per-Service geometry, so a builder called here would
 * paint one stripe per ServicePlan while the reader painted one per Line.
 */
export async function projectEmbedScene(request: EmbedSceneRequest): Promise<SystemFeatures> {
  const system =
    request.presentation.viewMode === 'diagram'
      ? (await import('@transitmapper/core/model/diagramLayout')).computeDiagramSystem(
          request.system,
        )
      : request.system;
  const projected = await request.projection.project({
    system,
    selection: null,
    handleWayIds: [],
    view: { ...request.presentation, presentation: renderPresentationForFittedMap(request.map) },
    sourceIds: EMBED_FEATURE_SOURCES,
    sceneRevision: `embed:${system.id}`,
  });
  return projected.features;
}

/** Publishes an accepted scene without touching icons or layers, so a replay
 * after a style swap cannot depend on a projection that has not returned. */
export function installEmbedSceneSources(map: MLMap, scene: SystemFeatures): void {
  const dataBySource: Record<string, GeoJSON.FeatureCollection> = {
    [SRC_WAYS]: scene.ways,
    [SRC_SERVICES]: scene.services,
    [SRC_STATIONS]: scene.stops,
    [SRC_FOOTPRINTS]: scene.footprints,
    [SRC_PLATFORMS]: scene.platforms,
    [SRC_FACILITIES]: scene.facilities,
  };
  for (const sourceId of EMBED_FEATURE_SOURCES) {
    const data = dataBySource[sourceId];
    const source: GeoJSONSource | undefined = map.getSource(sourceId);
    if (source) {
      source.setData(data);
      continue;
    }
    const heavy = sourceId === SRC_WAYS || sourceId === SRC_SERVICES;
    map.addSource(sourceId, { type: 'geojson', data, ...(heavy ? { tolerance: 1 } : {}) });
  }
}

function restoreEmbedOverlay(map: MLMap, scene: SystemFeatures, scheme: ColorScheme): void {
  registerMapIcons(map, scheme);
  installEmbedSceneSources(map, scene);
  for (const spec of embedLayerSpecsForScheme(scheme)) {
    if (!map.getLayer(spec.id)) map.addLayer(spec);
  }
}

interface DrawSystemOptions {
  map: MLMap;
  scene: SystemFeatures;
  scheme: ColorScheme;
  runtime: EmbedMapRuntimeOptions;
}

async function drawSystem({ map, scene, scheme, runtime }: DrawSystemOptions): Promise<void> {
  restoreEmbedOverlay(map, scene, scheme);
  runtime.milestones.systemCommitted();
  await waitForSystemPaint(map);
  markFirstSystemMapPaint();
}

function restoreCamera(map: MLMap, content: EmbedContent): void {
  map.resize();
  map.jumpTo({
    center: content.state.camera.center,
    zoom: content.state.camera.zoom,
  });
}

function updateEmbedLabels(content: EmbedContent): void {
  document.title = `${content.title} · TransitMapper`;
  // The credit link doubles as the way out of the iframe — a reader who wants
  // to explore or fork opens the real app in a new tab.
  const credit = document.getElementById('embed-open');
  if (credit instanceof HTMLAnchorElement) {
    credit.href = content.openPath;
    credit.textContent = content.title
      ? `${content.title} · TransitMapper`
      : 'Open in TransitMapper';
  }
}

/** Runs only after the host shell has committed. The system request passed in
 * by embed-bootstrap is already in flight, so this module's parse/setup work
 * cannot serialize the data fetch behind MapLibre. */
export async function startEmbedMap(options: EmbedMapRuntimeOptions): Promise<void> {
  const initialScheme = getSystemColorScheme();
  const map = createMap(options.container, initialScheme, options);
  const projection = createFeatureProjectionWorker();
  // The Line scene is clipped to the camera it was resolved for, and a reader
  // can pan an embed straight off that clip. The worker therefore outlives the
  // first paint instead of being disposed once the system commits.
  map.on('remove', () => projection.dispose());
  let detachScheme = () => {};
  try {
    const [content] = await Promise.all([options.content, waitForMapLoad(map)]);
    restoreCamera(map, content);
    const presentation = resolveDocumentMapPresentation(content.state);
    let scene = await projectEmbedScene({ projection, system: content.system, presentation, map });
    let activeScheme = initialScheme;
    updateEmbedLabels(content);
    await drawSystem({ map, scene, scheme: initialScheme, runtime: options });
    let sceneGeneration = 0;
    const reprojectScene = () => {
      const generation = ++sceneGeneration;
      void projectEmbedScene({ projection, system: content.system, presentation, map })
        .then((next) => {
          // A superseded projection may still finish. Request order, not
          // arrival order, decides which scene the embed keeps.
          if (generation !== sceneGeneration) return;
          scene = next;
          installEmbedSceneSources(map, scene);
        })
        .catch((error: unknown) => console.error('[transitmapper embed] scene', error));
    };
    map.on('moveend', reprojectScene);
    map.on('resize', reprojectScene);
    const styleSwitcher = createEmbedStyleController({
      map,
      initialTheme: initialScheme,
      local: localBlankStyleForScheme,
      remoteUrl: basemapStyleForScheme,
      carry: (previous, next, scheme) =>
        carryDocumentStyle(previous, next, embedLayerSpecsForScheme(scheme)),
      isDocumentStateRetained: () => embedOverlayIsRetained(map.getStyle(), activeScheme),
      onThemeApplied: (scheme) => {
        activeScheme = scheme;
      },
      timeoutMs: INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
      isInteractionActive: () => false,
      recoverDocumentLayers: (scheme, fullRebuild) => {
        if (fullRebuild) {
          for (const layer of [...embedLayerSpecsForScheme(scheme)].reverse()) {
            if (map.getLayer(layer.id)) map.removeLayer(layer.id);
          }
        }
        restoreEmbedOverlay(map, scene, scheme);
      },
      reportError: (error) => console.error('[transitmapper embed] map runtime', error),
      onUnavailable: (error) => console.error('[transitmapper embed] background map', error),
    });
    const onStyleLoad = () => restoreEmbedOverlay(map, scene, activeScheme);
    map.on('style.load', onStyleLoad);
    detachScheme = subscribeSystemColorScheme(
      () => void styleSwitcher.request(getSystemColorScheme()),
    );
    map.on('remove', () => {
      detachScheme();
      styleSwitcher.dispose();
      map.off('style.load', onStyleLoad);
      map.off('moveend', reprojectScene);
      map.off('resize', reprojectScene);
    });
    const status = document.getElementById('embed-status');
    if (status) status.hidden = true;
    options.milestones.interactive();
  } catch (error) {
    map.remove();
    throw error;
  }
}
