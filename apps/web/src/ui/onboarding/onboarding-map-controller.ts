import { systemBounds } from '@transitmapper/core/model/geo';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { SystemFeatures, ViewOptions } from '@transitmapper/core/render/buildFeatures';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import {
  attachInitialStyleFallback,
  INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
} from '../../map/initialStyleFallback';
import { setExportFeatureData } from '../../map/export/exportLayerSetup';
import {
  buildFeatures,
  registerMapIcons,
  SRC_PREVIEW,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_VEHICLES,
  SRC_WAYS,
} from '../../map/layers';
import { basemapStyleForScheme, layerSpecsForScheme } from '../../map/mapTheme';
import type { ColorScheme } from '../../theme/systemColorScheme';
import {
  ONBOARDING_DRAW_PATH,
  ONBOARDING_DRAW_SYSTEM,
  ONBOARDING_FIXTURE_SYSTEM,
  onboardingViewOptions,
} from './fixtureSystem';
import {
  ONBOARDING_CONTEXT_ATTRIBUTION,
  ONBOARDING_CONTEXT_SOURCE_URL,
  ONBOARDING_PLACE_LABELS,
  ONBOARDING_STREET_FEATURES,
} from './las-vegas-context';
import {
  onboardingDrawnServiceFeatures,
  onboardingScenePresentation,
  pathPrefix,
  vehicleFeaturesAt,
} from './scene-geometry';
import { onboardingSceneFrame } from './scene-timing';
import type { OnboardingSceneId } from './slides';

const STREET_SOURCE = 'onboarding-street-context';
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface MountOnboardingMapOptions {
  container: HTMLElement;
  colorScheme: ColorScheme;
  scene: OnboardingSceneId;
  reducedMotion: boolean;
  onFailure: (error: unknown) => void;
}

interface SceneSystems {
  resolvedSystem: TransitSystem;
  completeSystem: TransitSystem;
  baseSystem: TransitSystem;
  resolvedView: ViewOptions;
}

interface SceneResources {
  markers: maplibregl.Marker[];
  resizeObserver?: ResizeObserver;
  stopAnimation: () => void;
}

function sourceData(map: MapLibreMap, sourceId: string, data: GeoJSON.FeatureCollection): void {
  map.getSource<GeoJSONSource>(sourceId)?.setData(data);
}

function lineCollection(
  coordinates: GeoJSON.Position[],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  if (coordinates.length < 2) return EMPTY_FC as GeoJSON.FeatureCollection<GeoJSON.LineString>;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      },
    ],
  };
}

export function resolveOnboardingSceneSystems(scene: OnboardingSceneId): SceneSystems {
  const resolvedSystem = scene === 'draw' ? ONBOARDING_DRAW_SYSTEM : ONBOARDING_FIXTURE_SYSTEM;
  const completeSystem = scene === 'draw' ? ONBOARDING_DRAW_SYSTEM : resolvedSystem;
  return {
    resolvedSystem,
    completeSystem,
    baseSystem: scene === 'draw' ? { ...completeSystem, services: [], stops: [] } : resolvedSystem,
    resolvedView: onboardingViewOptions(scene === 'infrastructure' ? 'infrastructure' : 'network'),
  };
}

function addOnboardingSources(map: MapLibreMap): void {
  map.addSource(STREET_SOURCE, {
    type: 'geojson',
    data: ONBOARDING_STREET_FEATURES,
    attribution: `<a href="${ONBOARDING_CONTEXT_SOURCE_URL}" target="_blank" rel="noreferrer">${ONBOARDING_CONTEXT_ATTRIBUTION}</a>`,
  });
}

function addContextLayers(map: MapLibreMap, dark: boolean): void {
  map.addLayer({
    id: 'onboarding-street-casing',
    type: 'line',
    source: STREET_SOURCE,
    filter: ['!=', ['get', 'kind'], 'rail'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': dark ? '#111310' : '#d8d5cc',
      'line-width': ['match', ['get', 'kind'], 'motorway', 5.8, 'major', 4.4, 2.6],
      'line-opacity': 0.9,
    },
  });
  map.addLayer({
    id: 'onboarding-streets',
    type: 'line',
    source: STREET_SOURCE,
    filter: ['!=', ['get', 'kind'], 'rail'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': dark ? '#555b56' : '#9e9b93',
      'line-width': ['match', ['get', 'kind'], 'motorway', 4, 'major', 2.8, 1.25],
      'line-opacity': ['match', ['get', 'kind'], 'street', 0.7, 0.9],
    },
  });
  map.addLayer({
    id: 'onboarding-existing-rail-casing',
    type: 'line',
    source: STREET_SOURCE,
    filter: ['==', ['get', 'kind'], 'rail'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': dark ? '#151614' : '#d8d5cc',
      'line-width': 4,
      'line-opacity': 0.9,
    },
  });
  map.addLayer({
    id: 'onboarding-existing-rail',
    type: 'line',
    source: STREET_SOURCE,
    filter: ['==', ['get', 'kind'], 'rail'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': dark ? '#8a8e88' : '#75766f',
      'line-width': 2,
      'line-dasharray': [2, 1.4],
      'line-opacity': 0.9,
    },
  });
}

function productionPromoteId(sourceId: string): string | undefined {
  if (sourceId === SRC_SERVICES) return 'serviceId';
  if (sourceId === SRC_WAYS || sourceId === SRC_STATIONS) return 'id';
  return undefined;
}

export function onboardingProductionLayerSpecs(colorScheme: ColorScheme) {
  return layerSpecsForScheme(colorScheme).filter((spec) => spec.type !== 'symbol');
}

function addProductionLayers(map: MapLibreMap, colorScheme: ColorScheme): void {
  const specs = onboardingProductionLayerSpecs(colorScheme);
  const sourceIds = new Set(
    specs.map((spec) => ('source' in spec ? spec.source : '')).filter(Boolean),
  );
  for (const sourceId of sourceIds) {
    if (!map.getSource(sourceId)) {
      const promoteId = productionPromoteId(sourceId);
      map.addSource(sourceId, {
        type: 'geojson',
        data: EMPTY_FC,
        ...(promoteId ? { promoteId } : {}),
      });
    }
  }
  for (const spec of specs) {
    if (!map.getLayer(spec.id)) map.addLayer(spec);
  }
}

function addPlaceMarkers(map: MapLibreMap): maplibregl.Marker[] {
  const markers = ONBOARDING_PLACE_LABELS.map((place) => {
    const element = document.createElement('span');
    element.className = `onboarding-place-label onboarding-place-label-${place.priority}`;
    element.textContent = place.label;
    element.setAttribute('aria-hidden', 'true');
    return new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(place.coord).addTo(map);
  });
  return markers;
}

function addDrawCursor(map: MapLibreMap): maplibregl.Marker {
  const element = document.createElement('span');
  element.className = 'onboarding-draw-crosshair';
  element.setAttribute('aria-hidden', 'true');
  return new maplibregl.Marker({ element, anchor: 'center' })
    .setLngLat(ONBOARDING_DRAW_PATH[0])
    .addTo(map);
}

interface DrawFrameOptions {
  map: MapLibreMap;
  completeFeatures: SystemFeatures;
  cursor: maplibregl.Marker;
  progress: number;
  cursorVisible: boolean;
}

function renderDrawFrame({
  map,
  completeFeatures,
  cursor,
  progress,
  cursorVisible,
}: DrawFrameOptions): void {
  const path = pathPrefix(ONBOARDING_DRAW_PATH, progress);
  if (progress >= 1) {
    sourceData(map, SRC_SERVICES, completeFeatures.services);
    sourceData(map, SRC_STATIONS, completeFeatures.stops);
    sourceData(map, SRC_PREVIEW, EMPTY_FC);
    cursor.getElement().hidden = true;
    return;
  }
  // Real line drawing accumulates committed, colored stretches while the
  // dashed route preview follows the pointer. Project the same two production
  // sources so the demonstration reads as drawing, not as a generic cursor
  // moving over an unchanged map.
  sourceData(map, SRC_SERVICES, onboardingDrawnServiceFeatures(completeFeatures, path));
  sourceData(map, SRC_PREVIEW, lineCollection(path));
  cursor.getElement().hidden = !cursorVisible;
  const cursorPosition = path.at(-1);
  if (cursorPosition) cursor.setLngLat(cursorPosition);
}

interface SceneAnimationOptions {
  map: MapLibreMap;
  scene: OnboardingSceneId;
  completeFeatures: SystemFeatures;
  reducedMotion: boolean;
  drawCursor?: maplibregl.Marker;
}

function startSceneAnimation({
  map,
  scene,
  completeFeatures,
  reducedMotion,
  drawCursor,
}: SceneAnimationOptions): () => void {
  const startedAt = performance.now();
  let animationFrame: number | undefined;
  const drawFrame = (now: number) => {
    const frame = onboardingSceneFrame(scene, now - startedAt, reducedMotion);
    if (scene === 'draw' && drawCursor) {
      renderDrawFrame({
        map,
        completeFeatures,
        cursor: drawCursor,
        progress: frame.routeProgress,
        cursorVisible: frame.cursorVisible,
      });
    } else if (scene === 'simulate') {
      sourceData(map, SRC_VEHICLES, vehicleFeaturesAt(frame.simMs));
    }
    const continuingDraw = scene === 'draw' && frame.routeProgress < 1;
    if (continuingDraw || frame.animateVehicles) animationFrame = requestAnimationFrame(drawFrame);
  };
  drawFrame(startedAt);
  return () => {
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  };
}

function fitScene(map: MapLibreMap): void {
  map.resize();
  const bounds = systemBounds(ONBOARDING_FIXTURE_SYSTEM);
  if (bounds) map.fitBounds(bounds, { padding: 32, animate: false });
}

function addCompactAttribution(map: MapLibreMap, container: HTMLElement): void {
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  // MapLibre briefly expands every newly mounted compact control. Onboarding
  // remounts a map per screen, so that introductory state otherwise covers a
  // route every time someone presses Next. Start in the same collapsed state
  // as the long-lived editor map; attribution remains one click away.
  const attribution = container.querySelector<HTMLDetailsElement>('.maplibregl-ctrl-attrib');
  if (attribution) {
    attribution.open = false;
    attribution.classList.remove('maplibregl-compact-show');
  }
}

function initializeScene(
  map: MapLibreMap,
  options: MountOnboardingMapOptions,
  systems: SceneSystems,
  usingLocalContext: boolean,
): SceneResources {
  registerMapIcons(map, options.colorScheme);
  // The real editor basemap is the normal context. The committed OSM snapshot
  // exists only so an unavailable tile host does not turn onboarding into a
  // blank panel or prevent someone from learning the product offline.
  if (usingLocalContext) {
    addOnboardingSources(map);
    addContextLayers(map, options.colorScheme === 'dark');
  }
  addProductionLayers(map, options.colorScheme);

  const baseFeatures = buildFeatures(systems.baseSystem, null, [], systems.resolvedView);
  const completeFeatures = buildFeatures(systems.completeSystem, null, [], systems.resolvedView);
  setExportFeatureData(map, baseFeatures);
  const presentation = onboardingScenePresentation(options.scene);
  if (presentation.selectedWayId) {
    map.setFeatureState({ source: SRC_WAYS, id: presentation.selectedWayId }, { selected: true });
  }
  const markers = usingLocalContext ? addPlaceMarkers(map) : [];
  const drawCursor = options.scene === 'draw' ? addDrawCursor(map) : undefined;
  if (drawCursor) markers.push(drawCursor);
  fitScene(map);
  const stopAnimation = startSceneAnimation({
    map,
    scene: options.scene,
    completeFeatures,
    reducedMotion: options.reducedMotion,
    drawCursor,
  });
  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => fitScene(map));
  resizeObserver?.observe(options.container);
  return { markers, resizeObserver, stopAnimation };
}

/** Mounts one deterministic, non-interactive map and returns its complete
 * cleanup. React owns when scenes change; this controller owns MapLibre's
 * sources, markers, animation, and resize lifecycle. */
export function mountOnboardingMap(options: MountOnboardingMapOptions): () => void {
  const systems = resolveOnboardingSceneSystems(options.scene);
  let map: MapLibreMap;
  try {
    map = new maplibregl.Map({
      container: options.container,
      style: basemapStyleForScheme(options.colorScheme),
      center: systems.resolvedSystem.viewport.center,
      zoom: systems.resolvedSystem.viewport.zoom,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      refreshExpiredTiles: false,
    });
    addCompactAttribution(map, options.container);
  } catch (error) {
    options.onFailure(error);
    return () => undefined;
  }

  let usingLocalContext = false;
  let resources: SceneResources | undefined;
  const detachInitialStyleFallback = attachInitialStyleFallback(map, {
    scheme: options.colorScheme,
    timeoutMs: INITIAL_STYLE_FALLBACK_TIMEOUT_MS,
    onFallback: () => {
      usingLocalContext = true;
    },
  });
  map.on('error', (event) => {
    console.error('[onboarding preview]', event.error ?? event);
  });
  map.on('load', () => {
    try {
      resources = initializeScene(map, options, systems, usingLocalContext);
    } catch (error) {
      options.onFailure(error);
    }
  });

  return () => {
    detachInitialStyleFallback();
    resources?.stopAnimation();
    resources?.resizeObserver?.disconnect();
    for (const marker of resources?.markers ?? []) marker.remove();
    map.remove();
  };
}
