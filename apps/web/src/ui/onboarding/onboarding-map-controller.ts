import { systemBounds } from '@transitmapper/core/model/geo';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { SystemFeatures, ViewOptions } from '@transitmapper/core/render/buildFeatures';
import { formatTimeOfDay, minutesOfDay } from '@transitmapper/core/sim/clock';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { setExportFeatureData } from '../../map/export/exportLayerSetup';
import {
  buildFeatures,
  registerMapIcons,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_VEHICLES,
} from '../../map/layers';
import { layerSpecsForScheme, localBlankStyleForScheme } from '../../map/mapTheme';
import type { ColorScheme } from '../../theme/systemColorScheme';
import {
  ONBOARDING_CONTEXT_FEATURES,
  ONBOARDING_DRAW_PATH,
  ONBOARDING_DRAW_SYSTEM,
  ONBOARDING_FIXTURE_SYSTEM,
  ONBOARDING_NEW_RAIL_PATH,
  ONBOARDING_PLACE_LABELS,
  ONBOARDING_SERVICE_COLOR,
  onboardingViewOptions,
} from './fixtureSystem';
import { pathPrefix, vehicleFeaturesAt } from './scene-geometry';
import { onboardingSceneFrame } from './scene-timing';
import type { OnboardingSceneId } from './slides';

const CONTEXT_SOURCE = 'onboarding-place-context';
const DRAW_SOURCE = 'onboarding-draw-preview';
const CURSOR_SOURCE = 'onboarding-draw-cursor';
const NEW_LINK_SOURCE = 'onboarding-new-link';
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface MountOnboardingMapOptions {
  container: HTMLElement;
  colorScheme: ColorScheme;
  scene: OnboardingSceneId;
  reducedMotion: boolean;
  onFailure: (error: unknown) => void;
  onClockChange: (label: string) => void;
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

function pointCollection(
  coordinates: GeoJSON.Position | undefined,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!coordinates) return EMPTY_FC as GeoJSON.FeatureCollection<GeoJSON.Point>;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates },
      },
    ],
  };
}

function resolveSystems(scene: OnboardingSceneId): SceneSystems {
  const resolvedSystem = scene === 'draw' ? ONBOARDING_DRAW_SYSTEM : ONBOARDING_FIXTURE_SYSTEM;
  const completeSystem = scene === 'draw' ? ONBOARDING_DRAW_SYSTEM : resolvedSystem;
  return {
    resolvedSystem,
    completeSystem,
    baseSystem:
      scene === 'draw' ? { ...completeSystem, services: [], stations: [] } : resolvedSystem,
    resolvedView: onboardingViewOptions(scene === 'infrastructure' ? 'infrastructure' : 'network'),
  };
}

function addOnboardingSources(map: MapLibreMap): void {
  map.addSource(CONTEXT_SOURCE, { type: 'geojson', data: ONBOARDING_CONTEXT_FEATURES });
  map.addSource(DRAW_SOURCE, { type: 'geojson', data: EMPTY_FC });
  map.addSource(CURSOR_SOURCE, { type: 'geojson', data: EMPTY_FC });
  map.addSource(NEW_LINK_SOURCE, {
    type: 'geojson',
    data: lineCollection(ONBOARDING_NEW_RAIL_PATH),
  });
}

function addContextLayers(map: MapLibreMap, dark: boolean): void {
  map.addLayer({
    id: 'onboarding-river',
    type: 'fill',
    source: CONTEXT_SOURCE,
    paint: { 'fill-color': dark ? '#17313e' : '#dceaf0', 'fill-opacity': 0.95 },
  });
  map.addLayer({
    id: 'onboarding-river-edge',
    type: 'line',
    source: CONTEXT_SOURCE,
    paint: { 'line-color': dark ? '#285164' : '#b8d4df', 'line-width': 1.5 },
  });
}

function addProductionLayers(map: MapLibreMap, colorScheme: ColorScheme): void {
  const specs = layerSpecsForScheme(colorScheme).filter((spec) => spec.type !== 'symbol');
  const sourceIds = new Set(
    specs.map((spec) => ('source' in spec ? spec.source : '')).filter(Boolean),
  );
  for (const sourceId of sourceIds) {
    if (!map.getSource(sourceId)) map.addSource(sourceId, { type: 'geojson', data: EMPTY_FC });
  }
  for (const spec of specs) {
    if (!map.getLayer(spec.id)) map.addLayer(spec);
  }
}

function addDemonstrationLayers(map: MapLibreMap): void {
  map.addLayer({
    id: 'onboarding-new-link-halo',
    type: 'line',
    source: NEW_LINK_SOURCE,
    paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.88 },
  });
  map.addLayer({
    id: 'onboarding-new-link',
    type: 'line',
    source: NEW_LINK_SOURCE,
    paint: { 'line-color': '#3157d5', 'line-width': 5, 'line-dasharray': [1.4, 1.1] },
  });
  map.addLayer({
    id: 'onboarding-draw-line',
    type: 'line',
    source: DRAW_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ONBOARDING_SERVICE_COLOR, 'line-width': 6 },
  });
  map.addLayer({
    id: 'onboarding-draw-cursor-ring',
    type: 'circle',
    source: CURSOR_SOURCE,
    paint: {
      'circle-radius': 9,
      'circle-color': '#ffffff',
      'circle-stroke-color': ONBOARDING_SERVICE_COLOR,
      'circle-stroke-width': 3,
    },
  });
  map.addLayer({
    id: 'onboarding-draw-cursor',
    type: 'circle',
    source: CURSOR_SOURCE,
    paint: { 'circle-radius': 3, 'circle-color': ONBOARDING_SERVICE_COLOR },
  });
}

function addPlaceMarkers(map: MapLibreMap): maplibregl.Marker[] {
  const markers = ONBOARDING_PLACE_LABELS.map((place) => {
    const element = document.createElement('span');
    element.className = `onboarding-place-label onboarding-place-label-${place.priority}`;
    element.textContent = place.label;
    element.setAttribute('aria-hidden', 'true');
    return new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(place.coord).addTo(map);
  });
  const river = document.createElement('span');
  river.className = 'onboarding-place-label onboarding-river-label';
  river.textContent = 'Mason River';
  river.setAttribute('aria-hidden', 'true');
  markers.push(
    new maplibregl.Marker({ element: river, anchor: 'center' })
      .setLngLat([-122.456, 37.751])
      .addTo(map),
  );
  return markers;
}

function renderDrawFrame(
  map: MapLibreMap,
  completeFeatures: SystemFeatures,
  progress: number,
  cursorVisible: boolean,
): void {
  const path = pathPrefix(ONBOARDING_DRAW_PATH, progress);
  if (progress >= 1) {
    sourceData(map, SRC_SERVICES, completeFeatures.services);
    sourceData(map, SRC_STATIONS, completeFeatures.stations);
    sourceData(map, DRAW_SOURCE, EMPTY_FC);
    sourceData(map, CURSOR_SOURCE, EMPTY_FC);
    return;
  }
  sourceData(map, DRAW_SOURCE, lineCollection(path));
  sourceData(map, CURSOR_SOURCE, pointCollection(cursorVisible ? path.at(-1) : undefined));
}

interface SceneAnimationOptions {
  map: MapLibreMap;
  scene: OnboardingSceneId;
  completeFeatures: SystemFeatures;
  reducedMotion: boolean;
  onClockChange: (label: string) => void;
}

function startSceneAnimation({
  map,
  scene,
  completeFeatures,
  reducedMotion,
  onClockChange,
}: SceneAnimationOptions): () => void {
  const startedAt = performance.now();
  let animationFrame: number | undefined;
  let lastClock = '';
  const drawFrame = (now: number) => {
    const frame = onboardingSceneFrame(scene, now - startedAt, reducedMotion);
    if (scene === 'draw') {
      renderDrawFrame(map, completeFeatures, frame.routeProgress, frame.cursorVisible);
    } else if (scene === 'simulate') {
      sourceData(map, SRC_VEHICLES, vehicleFeaturesAt(frame.simMs));
      const clock = formatTimeOfDay(minutesOfDay(frame.simMs));
      if (clock !== lastClock) {
        lastClock = clock;
        onClockChange(clock);
      }
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

function initializeScene(
  map: MapLibreMap,
  options: MountOnboardingMapOptions,
  systems: SceneSystems,
): SceneResources {
  registerMapIcons(map, options.colorScheme);
  addOnboardingSources(map);
  addContextLayers(map, options.colorScheme === 'dark');
  addProductionLayers(map, options.colorScheme);
  addDemonstrationLayers(map);

  const baseFeatures = buildFeatures(systems.baseSystem, null, [], systems.resolvedView);
  const completeFeatures = buildFeatures(systems.completeSystem, null, [], systems.resolvedView);
  setExportFeatureData(map, baseFeatures);
  sourceData(
    map,
    NEW_LINK_SOURCE,
    options.scene === 'infrastructure' ? lineCollection(ONBOARDING_NEW_RAIL_PATH) : EMPTY_FC,
  );
  const markers = addPlaceMarkers(map);
  fitScene(map);
  const stopAnimation = startSceneAnimation({
    map,
    scene: options.scene,
    completeFeatures,
    reducedMotion: options.reducedMotion,
    onClockChange: options.onClockChange,
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
  const systems = resolveSystems(options.scene);
  let map: MapLibreMap;
  try {
    map = new maplibregl.Map({
      container: options.container,
      style: localBlankStyleForScheme(options.colorScheme),
      center: systems.resolvedSystem.viewport.center,
      zoom: systems.resolvedSystem.viewport.zoom,
      interactive: false,
      attributionControl: false,
    });
  } catch (error) {
    options.onFailure(error);
    return () => undefined;
  }

  let ready = false;
  let resources: SceneResources | undefined;
  map.on('error', (event) => {
    console.error('[onboarding preview]', event.error ?? event);
    if (!ready) options.onFailure(event.error ?? event);
  });
  map.on('load', () => {
    try {
      resources = initializeScene(map, options, systems);
      ready = true;
    } catch (error) {
      options.onFailure(error);
    }
  });

  return () => {
    resources?.stopAnimation();
    resources?.resizeObserver?.disconnect();
    for (const marker of resources?.markers ?? []) marker.remove();
    map.remove();
  };
}
