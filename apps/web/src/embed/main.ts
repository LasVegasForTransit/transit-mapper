import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../theme/font.css';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { systemBounds } from '@transitmapper/core/model/geo';
import { MODE_ORDER, WAY_TYPE_ORDER } from '@transitmapper/core/model/catalog';
import { buildFeatures, type ViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { GetShareResponse } from '@transitmapper/core/share/contract';
import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  registerMapIcons,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAYS,
} from '../map/layers';
import { fetchWithTimeout } from '../network/fetchWithTimeout';
import { EMBED_SOURCE_IDS, embedLayerSpecsForScheme } from './config';
import { markFirstSystemMapPaint } from '../perf/mapPaintMark';
import {
  getSystemColorScheme,
  subscribeSystemColorScheme,
  type ColorScheme,
} from '../theme/systemColorScheme';
import { basemapStyleForScheme } from '../map/mapTheme';
import { createStyleSwitchController } from '../map/styleSwitchController';

const PERF_HARNESS_BUILD = import.meta.env.DEV || import.meta.env.VITE_PERF_BUILD === '1';

// The embedded map: a live, read-only view of one shared system, meant to sit
// in someone else's article. Deliberately NOT the editor with its chrome
// hidden — an embed competes with the host page's load budget, so this entry
// pulls in MapLibre and core's feature builder and nothing else. No React, no
// editor store, no toolbars, no inspector.
//
// It shows the schematic (Network view). Infrastructure detail is a planning
// tool; someone reading a blog post wants to see the lines.

const EMBED_VIEW: ViewOptions = {
  viewMode: 'network',
  visibleModes: new Set(MODE_ORDER),
  visibleWayTypes: new Set(WAY_TYPE_ORDER),
};

const MAP_LOAD_TIMEOUT_MS = 20_000;
const SYSTEM_PAINT_TIMEOUT_MS = 10_000;

function shareIdFromPath(pathname: string): string | null {
  const match = /^\/e\/([0-9a-z]{1,32})\/?$/.exec(pathname);
  return match?.[1] ?? null;
}

function fail(message: string): void {
  const el = document.getElementById('embed-status');
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

async function loadSystem(id: string, signal: AbortSignal): Promise<TransitSystem> {
  const res = await fetchWithTimeout(`/api/systems/${encodeURIComponent(id)}`, {}, { signal });
  if (res.status === 404) throw new Error('This shared system was not found.');
  if (!res.ok) throw new Error(`Couldn't load this system (${res.status}).`);
  const data = (await res.json()) as GetShareResponse;
  return parseSystem(data.system);
}

function createMap(container: HTMLElement, scheme: ColorScheme): MLMap {
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
  map.on('error', (e) => console.error('[transitmapper embed]', e.error ?? e));
  return map;
}

function waitForMapLoad(map: MLMap): Promise<void> {
  if (map.loaded()) return Promise.resolve();
  return new Promise((resolve, reject) => {
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
      resolve();
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
  return new Promise((resolve, reject) => {
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
      resolve();
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

async function drawSystem(
  map: MLMap,
  system: TransitSystem,
  features: ReturnType<typeof buildFeatures>,
  scheme: ColorScheme,
): Promise<void> {
  restoreEmbedOverlay(map, features, scheme);

  // Resize before framing, never after: fitBounds solves for the viewport
  // it's told about, so fitting against a stale size frames the wrong extent.
  map.resize();
  const bounds = systemBounds(system);
  if (bounds) map.fitBounds(bounds, { padding: 40, animate: false });
  await waitForSystemPaint(map);
  markFirstSystemMapPaint();
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

async function start(): Promise<void> {
  const id = shareIdFromPath(window.location.pathname);
  if (!id) {
    fail('No system to show.');
    return;
  }

  const container = document.getElementById('map');
  if (!container) {
    fail('No map container was found.');
    return;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort(new DOMException('Embed closed.', 'AbortError'));
  window.addEventListener('pagehide', cancel, { once: true });
  const initialScheme = getSystemColorScheme();
  const map = createMap(container, initialScheme);
  let detachScheme = () => {};

  try {
    const systemAndFeatures = loadSystem(id, controller.signal).then((system) => ({
      system,
      features: buildFeatures(system, null, [], EMBED_VIEW),
    }));
    const [{ system, features }] = await Promise.all([systemAndFeatures, waitForMapLoad(map)]);
    document.title = `${system.name || 'Transit system'} · TransitMapper`;

    // The credit link doubles as the way out of the iframe — a reader who
    // wants to explore or fork opens the real app in a new tab.
    const credit = document.getElementById('embed-credit');
    if (credit instanceof HTMLAnchorElement) {
      credit.href = `/s/${id}`;
      credit.textContent = system.name ? `${system.name} · TransitMapper` : 'Open in TransitMapper';
    }

    await drawSystem(map, system, features, initialScheme);
    let activeScheme = initialScheme;
    const styleSwitcher = createStyleSwitchController({
      map,
      initialScheme,
      isInteractionActive: () => false,
      layerSpecs: embedLayerSpecsForScheme,
      recover: (scheme, fullRebuild) => {
        activeScheme = scheme;
        if (!fullRebuild) restoreEmbedOverlay(map, features, scheme);
      },
      onUnavailable: (_scheme, error) => console.error('[transitmapper embed]', error),
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
  } catch (e) {
    map.remove();
    // An embed is nothing but a remote system on a remote basemap, so being
    // offline explains the entire failure and the exception text explains
    // none of it. Checked here rather than subscribed to: this page has no
    // React and nothing to re-render if the network comes back.
    fail(
      navigator.onLine
        ? (e as Error).message
        : 'This map needs a connection, and the browser is offline.',
    );
  } finally {
    window.removeEventListener('pagehide', cancel);
  }
}

void start();
