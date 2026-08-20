import type { SystemFeatures } from '@transitmapper/core/render/buildFeatures';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from 'maplibre-gl';
import { SRC_PREVIEW, SRC_SERVICES, SRC_STATIONS, SRC_VEHICLES } from '../../map/layers';
import { ONBOARDING_DRAW_PATH } from './fixtureSystem';
import { onboardingDrawnServiceFeatures, pathPrefix, vehicleFeaturesAt } from './scene-geometry';
import { onboardingSceneFrame } from './scene-timing';
import type { OnboardingSceneId } from './slides';

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

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

function addDrawCursor(map: MapLibreMap): maplibregl.Marker {
  const element = document.createElement('span');
  element.className = 'onboarding-draw-crosshair';
  element.setAttribute('aria-hidden', 'true');
  return new maplibregl.Marker({ element, anchor: 'center' })
    .setLngLat(ONBOARDING_DRAW_PATH[0])
    .addTo(map);
}

interface SceneResources {
  completeFeatures: SystemFeatures;
  cursor?: maplibregl.Marker;
  elapsedMs: number;
  scene: OnboardingSceneId;
}

function renderFrame(map: MapLibreMap, resources: SceneResources, reducedMotion: boolean): boolean {
  const frame = onboardingSceneFrame(resources.scene, resources.elapsedMs, reducedMotion);
  if (resources.scene === 'draw' && resources.cursor) {
    const path = pathPrefix(ONBOARDING_DRAW_PATH, frame.routeProgress);
    if (frame.routeProgress >= 1) {
      sourceData(map, SRC_SERVICES, resources.completeFeatures.services);
      sourceData(map, SRC_STATIONS, resources.completeFeatures.stops);
      sourceData(map, SRC_PREVIEW, EMPTY_FC);
      resources.cursor.getElement().hidden = true;
    } else {
      // Real drawing accumulates committed stretches while the dashed route
      // preview follows the pointer, as it does in the editor.
      sourceData(
        map,
        SRC_SERVICES,
        onboardingDrawnServiceFeatures(resources.completeFeatures, path),
      );
      sourceData(map, SRC_PREVIEW, lineCollection(path));
      resources.cursor.getElement().hidden = !frame.cursorVisible;
      const cursorPosition = path.at(-1);
      if (cursorPosition) resources.cursor.setLngLat(cursorPosition);
    }
  } else if (resources.scene === 'simulate') {
    sourceData(map, SRC_VEHICLES, vehicleFeaturesAt(frame.simMs));
  }
  return (resources.scene === 'draw' && frame.routeProgress < 1) || frame.animateVehicles;
}

/** Owns the one pending callback and the scene-specific marker for a stable
 * onboarding map. Source installation and static projection remain with the
 * map controller. */
export class OnboardingSceneAnimation {
  private animationFrame: number | undefined;
  private animationGeneration = 0;
  private animationStartedAt: number | undefined;
  private disposed = false;
  private resources: SceneResources | undefined;

  constructor(
    private readonly map: MapLibreMap,
    private reducedMotion: boolean,
  ) {}

  setScene(scene: OnboardingSceneId, completeFeatures: SystemFeatures, visible: boolean): void {
    this.stop(false);
    this.resources?.cursor?.remove();
    sourceData(this.map, SRC_PREVIEW, EMPTY_FC);
    sourceData(this.map, SRC_VEHICLES, EMPTY_FC);
    this.resources = {
      completeFeatures,
      cursor: scene === 'draw' ? addDrawCursor(this.map) : undefined,
      elapsedMs: 0,
      scene,
    };
    this.start(visible);
  }

  setVisible(visible: boolean): void {
    if (!visible) {
      this.stop(true);
      return;
    }
    this.start(true);
  }

  setReducedMotion(reducedMotion: boolean, visible: boolean): void {
    this.reducedMotion = reducedMotion;
    if (reducedMotion) {
      this.stop(true);
      if (visible && this.resources) renderFrame(this.map, this.resources, true);
      return;
    }
    this.start(visible);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop(false);
    this.resources?.cursor?.remove();
  }

  private stop(preserveElapsed: boolean): void {
    this.animationGeneration++;
    if (preserveElapsed && this.resources && this.animationStartedAt !== undefined) {
      this.resources.elapsedMs = Math.max(
        this.resources.elapsedMs,
        performance.now() - this.animationStartedAt,
      );
    }
    this.animationStartedAt = undefined;
    if (this.animationFrame !== undefined) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
  }

  private start(visible: boolean): void {
    this.stop(false);
    const activeResources = this.resources;
    if (!activeResources || !visible || this.disposed) return;
    if (this.reducedMotion) {
      renderFrame(this.map, activeResources, true);
      return;
    }
    if (activeResources.scene !== 'draw' && activeResources.scene !== 'simulate') return;

    const generation = this.animationGeneration;
    this.animationStartedAt = performance.now() - activeResources.elapsedMs;
    const paint = (now: number) => {
      this.animationFrame = undefined;
      if (
        this.disposed ||
        generation !== this.animationGeneration ||
        this.resources !== activeResources
      )
        return;
      activeResources.elapsedMs = Math.max(0, now - (this.animationStartedAt ?? now));
      if (renderFrame(this.map, activeResources, false)) {
        this.animationFrame = requestAnimationFrame(paint);
      }
    };
    this.animationFrame = requestAnimationFrame(paint);
  }
}
