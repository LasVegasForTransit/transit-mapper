import type { Feature, Point } from 'geojson';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { GestureProjection } from './gestureProjection';

export interface StopGesturePreviewControllerOptions {
  render: (projection: GestureProjection | null) => boolean;
}

export interface StopGesturePreviewController {
  showActive: (projection: GestureProjection | null) => boolean;
  clearActive: () => boolean;
  retainCommitted: (stopIds: readonly string[], features: readonly Feature<Point>[]) => boolean;
  retainActiveStops: (stopIds: readonly string[]) => boolean;
  syncStops: (system: TransitSystem) => boolean;
  refresh: () => boolean;
  releaseStops: () => boolean;
  clear: () => boolean;
}

function stringProperty(feature: Feature, key: string): string | null {
  const value: unknown = feature.properties?.[key];
  return typeof value === 'string' ? value : null;
}

/** Convert exact committed stop features into the lightweight, interactive
 * points retained by the gesture source while MapLibre applies their diff. */
export function createStopSettlementPreviewFeatures(
  features: readonly Feature<Point>[],
): Feature<Point>[] {
  return features.flatMap((feature) => {
    const id = stringProperty(feature, 'id');
    if (!id) return [];
    return [
      {
        type: 'Feature',
        properties: { kind: 'stop', ownerId: id, id },
        geometry: feature.geometry,
      },
    ];
  });
}

function retainedSettlementFeatures(
  activeStopIds: Set<string>,
  settlingStopFeatures: readonly Feature<Point>[],
): Feature<Point>[] {
  return settlingStopFeatures.filter((feature) => {
    const id = stringProperty(feature, 'id');
    return id !== null && !activeStopIds.has(id);
  });
}

function combinedAffected(
  active: GestureProjection | null,
  settlingStopIds: readonly string[],
): GestureProjection['affected'] {
  return {
    wayIds: active?.affected.wayIds ?? [],
    stopIds: [...new Set([...settlingStopIds, ...(active?.affected.stopIds ?? [])])],
    stationIds: active?.affected.stationIds ?? [],
    facilityIds: active?.affected.facilityIds ?? [],
    groupIds: active?.affected.groupIds ?? [],
    nodeIds: active?.affected.nodeIds ?? [],
  };
}

/**
 * Compose the active gesture with older stop points whose committed source
 * mutations are still pending. An active repeat drag replaces the older point
 * for that ID; a deleted stop may retain only its mask owner and no point.
 */
export function combineGestureSettlementPreview(
  active: GestureProjection | null,
  settlingStopIds: readonly string[],
  settlingStopFeatures: readonly Feature<Point>[],
): GestureProjection | null {
  if (!active && settlingStopIds.length === 0) return null;
  const activeStopIds = new Set(active?.affected.stopIds ?? []);
  const retainedSettlingFeatures = retainedSettlementFeatures(activeStopIds, settlingStopFeatures);

  return {
    data: {
      type: 'FeatureCollection',
      features: [...retainedSettlingFeatures, ...(active?.data.features ?? [])],
    },
    affected: combinedAffected(active, settlingStopIds),
  };
}

/**
 * Keeps active and settling geometry in one scratch-source projection. The map
 * integration owns only when to transition; this controller owns the exact
 * feature and mask composition across overlapping gestures and store updates.
 */
export function createStopGesturePreviewController({
  render,
}: StopGesturePreviewControllerOptions): StopGesturePreviewController {
  let active: GestureProjection | null = null;
  const settlingIds = new Set<string>();
  const settlingFeatures = new Map<string, Feature<Point>>();

  const renderCurrent = () =>
    render(
      combineGestureSettlementPreview(active, [...settlingIds], [...settlingFeatures.values()]),
    );

  return {
    showActive(projection) {
      active = projection;
      return renderCurrent();
    },
    clearActive() {
      active = null;
      return renderCurrent();
    },
    retainCommitted(stopIds, features) {
      for (const stopId of stopIds) settlingIds.add(stopId);
      for (const feature of createStopSettlementPreviewFeatures(features)) {
        const id = stringProperty(feature, 'id');
        if (id) settlingFeatures.set(id, feature);
      }
      active = null;
      return renderCurrent();
    },
    retainActiveStops(stopIds) {
      for (const stopId of stopIds) settlingIds.add(stopId);
      for (const feature of active?.data.features ?? []) {
        const id = stringProperty(feature, 'id');
        if (feature.geometry.type === 'Point' && feature.properties?.kind === 'stop' && id) {
          settlingFeatures.set(id, feature as Feature<Point>);
        }
      }
      active = null;
      return renderCurrent();
    },
    syncStops(system) {
      for (const stopId of settlingIds) {
        const stop = system.stops.find((candidate) => candidate.id === stopId);
        if (!stop) {
          settlingFeatures.delete(stopId);
          continue;
        }
        settlingFeatures.set(stopId, {
          type: 'Feature',
          properties: { kind: 'stop', ownerId: stopId, id: stopId },
          geometry: { type: 'Point', coordinates: stop.coord },
        });
      }
      return renderCurrent();
    },
    refresh: renderCurrent,
    releaseStops() {
      settlingIds.clear();
      settlingFeatures.clear();
      return renderCurrent();
    },
    clear() {
      active = null;
      settlingIds.clear();
      settlingFeatures.clear();
      return renderCurrent();
    },
  };
}
