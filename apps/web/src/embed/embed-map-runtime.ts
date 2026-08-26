import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { INITIAL_STYLE_FALLBACK_TIMEOUT_MS } from '@transitmapper/map';
import { buildFeatures } from '@transitmapper/core/render/buildFeatures';
import { resolveDocumentMapPresentation } from '@transitmapper/renderer/presentation';
import {
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAYS,
} from '@transitmapper/renderer/layers';
import { registerMapIcons } from '../map/layers';
import { EMBED_SOURCE_IDS, embedLayerSpecsForScheme } from './config';
import { markFirstSystemMapPaint } from '../perf/mapPaintMark';
import {
  getSystemColorScheme,
  subscribeSystemColorScheme,
  type ColorScheme,
} from '../theme/color-scheme';
import { basemapStyleForScheme, localBlankStyleForScheme } from '../map/mapTheme';
import { renderPresentationForFittedMap } from '../map/static-render-features';
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

function restoreEmbedOverlay(
  map: MLMap,
  features: ReturnType<typeof buildFeatures>,
  scheme: ColorScheme,
): void {
  registerMapIcons(map, scheme);
  const dataBySource: Record<string, GeoJSON.FeatureCollection> = {
    [SRC_WAYS]: features.ways,
    [SRC_SERVICES]: features.services,
    [SRC_STATIONS]: features.stops,
    [SRC_FOOTPRINTS]: features.footprints,
    [SRC_PLATFORMS]: features.platforms,
    [SRC_FACILITIES]: features.facilities,
  };
  for (const sourceId of EMBED_SOURCE_IDS) {
    if (map.getSource(sourceId)) continue;
    const heavy = sourceId === SRC_WAYS || sourceId === SRC_SERVICES;
    map.addSource(sourceId, {
      type: 'geojson',
      data: dataBySource[sourceId],
      ...(heavy ? { tolerance: 1 } : {}),
    });
  }
  for (const spec of embedLayerSpecsForScheme(scheme)) {
    if (!map.getLayer(spec.id)) map.addLayer(spec);
  }
}

interface DrawSystemOptions {
  map: MLMap;
  features: ReturnType<typeof buildFeatures>;
  scheme: ColorScheme;
  runtime: EmbedMapRuntimeOptions;
}

async function drawSystem({ map, features, scheme, runtime }: DrawSystemOptions): Promise<void> {
  restoreEmbedOverlay(map, features, scheme);
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
  let detachScheme = () => {};
  try {
    const [content] = await Promise.all([options.content, waitForMapLoad(map)]);
    restoreCamera(map, content);
    const presentation = resolveDocumentMapPresentation(content.state);
    const features = buildFeatures(content.system, null, [], {
      ...presentation,
      presentation: renderPresentationForFittedMap(map),
    });
    updateEmbedLabels(content);
    await drawSystem({ map, features, scheme: initialScheme, runtime: options });
    let activeScheme = initialScheme;
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
        restoreEmbedOverlay(map, features, scheme);
      },
      reportError: (error) => console.error('[transitmapper embed] map runtime', error),
      onUnavailable: (error) => console.error('[transitmapper embed] background map', error),
    });
    const onStyleLoad = () => restoreEmbedOverlay(map, features, activeScheme);
    map.on('style.load', onStyleLoad);
    detachScheme = subscribeSystemColorScheme(
      () => void styleSwitcher.request(getSystemColorScheme()),
    );
    map.on('remove', () => {
      detachScheme();
      styleSwitcher.dispose();
      map.off('style.load', onStyleLoad);
    });
    const status = document.getElementById('embed-status');
    if (status) status.hidden = true;
    options.milestones.interactive();
  } catch (error) {
    map.remove();
    throw error;
  }
}
