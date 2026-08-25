import { systemBounds } from '@transitmapper/core/model/geo';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { RenderViewOptions, ViewOptions } from '@transitmapper/core/render/buildFeatures';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { setExportFeatureData } from '../../map/export/exportLayerSetup';
import { SRC_SERVICES, SRC_STATIONS, SRC_WAYS } from '@transitmapper/renderer/layers';
import { registerMapIcons } from '../../map/layers';
import { buildFeatures } from '@transitmapper/core/render/buildFeatures';
import { renderPresentationForFittedMap } from '../../map/fitted-map-presentation';
import { layerSpecsForScheme, localBlankStyleForScheme } from '../../map/mapTheme';
import type { ColorScheme } from '../../theme/systemColorScheme';
import {
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
import { onboardingScenePresentation } from './scene-geometry';
import { OnboardingSceneAnimation } from './onboarding-scene-animation';
import type { OnboardingSceneId } from './slides';

const STREET_SOURCE = 'onboarding-street-context';
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export interface MountOnboardingMapOptions {
  container: HTMLElement;
  colorScheme: ColorScheme;
  /** Test seam for environments without a live media query. Production reads
   * the current preference and follows changes for the controller's lifetime. */
  reducedMotion?: boolean;
  onFailure: (error: unknown) => void;
}

export interface OnboardingMapController {
  setColorScheme: (colorScheme: ColorScheme) => void;
  setScene: (scene: OnboardingSceneId) => void;
  dispose: () => void;
}

interface SceneSystems {
  resolvedSystem: TransitSystem;
  completeSystem: TransitSystem;
  baseSystem: TransitSystem;
  resolvedView: ViewOptions;
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

function updateLayerPaint(
  map: MapLibreMap,
  layer: ReturnType<typeof onboardingProductionLayerSpecs>[number],
): void {
  if (!map.getLayer(layer.id) || !layer.paint) return;
  for (const [property, value] of Object.entries(layer.paint)) {
    map.setPaintProperty(layer.id, property, value);
  }
}

function applyOnboardingColorScheme(map: MapLibreMap, colorScheme: ColorScheme): void {
  const dark = colorScheme === 'dark';
  map.setPaintProperty('onboarding-street-casing', 'line-color', dark ? '#111310' : '#d8d5cc');
  map.setPaintProperty('onboarding-streets', 'line-color', dark ? '#555b56' : '#9e9b93');
  map.setPaintProperty(
    'onboarding-existing-rail-casing',
    'line-color',
    dark ? '#151614' : '#d8d5cc',
  );
  map.setPaintProperty('onboarding-existing-rail', 'line-color', dark ? '#8a8e88' : '#75766f');
  for (const layer of onboardingProductionLayerSpecs(colorScheme)) updateLayerPaint(map, layer);
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

function fitScene(map: MapLibreMap): void {
  map.resize();
  const bounds = systemBounds(ONBOARDING_FIXTURE_SYSTEM);
  if (bounds) map.fitBounds(bounds, { padding: 32, animate: false });
}

function addCompactAttribution(map: MapLibreMap, container: HTMLElement): void {
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  // MapLibre briefly expands a newly mounted compact control. Start in the
  // same collapsed state as the editor map; attribution remains one click
  // away without covering the first scene.
  const attribution = container.querySelector<HTMLDetailsElement>('.maplibregl-ctrl-attrib');
  if (attribution) {
    attribution.open = false;
    attribution.classList.remove('maplibregl-compact-show');
  }
}

class OnboardingMapHost implements OnboardingMapController {
  private activeScene: OnboardingSceneId | undefined;
  private readonly animation: OnboardingSceneAnimation;
  private colorScheme: ColorScheme;
  private disposed = false;
  private loaded = false;
  private readonly motionQuery: MediaQueryList | undefined;
  private placeMarkers: maplibregl.Marker[] = [];
  private resizeObserver: ResizeObserver | undefined;
  private selectedWayId: string | undefined;

  constructor(
    private readonly map: MapLibreMap,
    private readonly options: MountOnboardingMapOptions,
  ) {
    this.colorScheme = options.colorScheme;
    this.motionQuery =
      options.reducedMotion === undefined
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : undefined;
    this.animation = new OnboardingSceneAnimation(
      map,
      options.reducedMotion ?? this.motionQuery?.matches ?? false,
    );
    map.on('error', this.onError);
    map.on('load', this.onLoad);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.motionQuery?.addEventListener('change', this.onReducedMotionChange);
  }

  setScene(scene: OnboardingSceneId): void {
    if (this.disposed || this.activeScene === scene) return;
    this.activeScene = scene;
    if (this.loaded) this.applyScene(scene);
  }

  setColorScheme(colorScheme: ColorScheme): void {
    if (this.disposed || this.colorScheme === colorScheme) return;
    this.colorScheme = colorScheme;
    if (this.loaded) applyOnboardingColorScheme(this.map, colorScheme);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.animation.dispose();
    this.resizeObserver?.disconnect();
    for (const marker of this.placeMarkers) marker.remove();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.motionQuery?.removeEventListener('change', this.onReducedMotionChange);
    this.map.off('error', this.onError);
    this.map.off('load', this.onLoad);
    this.map.remove();
  }

  private applyScene(scene: OnboardingSceneId): void {
    if (this.selectedWayId) {
      this.map.setFeatureState({ source: SRC_WAYS, id: this.selectedWayId }, { selected: false });
      this.selectedWayId = undefined;
    }
    const systems = resolveOnboardingSceneSystems(scene);
    const renderView: RenderViewOptions = {
      ...systems.resolvedView,
      presentation: renderPresentationForFittedMap(this.map),
    };
    const baseFeatures = buildFeatures(systems.baseSystem, null, [], renderView);
    const completeFeatures = buildFeatures(systems.completeSystem, null, [], renderView);
    setExportFeatureData(this.map, baseFeatures);
    this.selectedWayId = onboardingScenePresentation(scene).selectedWayId ?? undefined;
    if (this.selectedWayId) {
      this.map.setFeatureState({ source: SRC_WAYS, id: this.selectedWayId }, { selected: true });
    }
    this.animation.setScene(scene, completeFeatures, document.visibilityState !== 'hidden');
  }

  private readonly onError = (event: { error?: unknown }) => {
    console.error('[onboarding preview]', event.error ?? event);
  };

  private readonly onLoad = () => {
    if (this.disposed || this.loaded) return;
    try {
      registerMapIcons(this.map, this.colorScheme);
      addOnboardingSources(this.map);
      addContextLayers(this.map, this.colorScheme === 'dark');
      addProductionLayers(this.map, this.colorScheme);
      // Projection reads the camera, so the map must fit the stable system
      // before any scene produces feature data.
      fitScene(this.map);
      this.placeMarkers = addPlaceMarkers(this.map);
      this.resizeObserver =
        typeof ResizeObserver === 'undefined'
          ? undefined
          : new ResizeObserver(() => fitScene(this.map));
      this.resizeObserver?.observe(this.options.container);
      this.loaded = true;
      if (this.activeScene) this.applyScene(this.activeScene);
    } catch (error) {
      this.options.onFailure(error);
    }
  };

  private readonly onVisibilityChange = () => {
    this.animation.setVisible(document.visibilityState !== 'hidden');
  };

  private readonly onReducedMotionChange = (event: MediaQueryListEvent) => {
    this.animation.setReducedMotion(event.matches, document.visibilityState !== 'hidden');
  };
}

/** Mounts one local, non-interactive map for the dialog lifetime. React only
 * selects scenes. This controller owns MapLibre, source replacement, motion,
 * visibility, and cleanup. */
export function mountOnboardingMap(options: MountOnboardingMapOptions): OnboardingMapController {
  try {
    const map = new maplibregl.Map({
      container: options.container,
      style: localBlankStyleForScheme(options.colorScheme),
      center: ONBOARDING_FIXTURE_SYSTEM.viewport.center,
      zoom: ONBOARDING_FIXTURE_SYSTEM.viewport.zoom,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      refreshExpiredTiles: false,
    });
    addCompactAttribution(map, options.container);
    return new OnboardingMapHost(map, options);
  } catch (error) {
    options.onFailure(error);
    return {
      setColorScheme: () => undefined,
      setScene: () => undefined,
      dispose: () => undefined,
    };
  }
}
