import type { Feature, Point } from 'geojson';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { GestureProjection } from './gestureProjection';

export interface StationGesturePreviewControllerOptions {
  render(projection: GestureProjection | null): boolean;
}

export interface StationGesturePreviewController {
  showActive(projection: GestureProjection | null): boolean;
  clearActive(): boolean;
  retainCommitted(stationIds: readonly string[], features: readonly Feature<Point>[]): boolean;
  retainActiveStations(stationIds: readonly string[]): boolean;
  syncStations(system: TransitSystem): boolean;
  refresh(): boolean;
  releaseStations(): boolean;
  clear(): boolean;
}

/** Convert exact committed station features into the lightweight, interactive
 * points retained by the gesture source while MapLibre applies their diff. */
export function createStationSettlementPreviewFeatures(
  features: readonly Feature<Point>[],
): Feature<Point>[] {
  return features.flatMap((feature) => {
    const id = feature.properties?.id;
    if (typeof id !== 'string') return [];
    return [
      {
        type: 'Feature',
        properties: { kind: 'station', ownerId: id, id },
        geometry: feature.geometry,
      },
    ];
  });
}

/**
 * Compose the active gesture with older station points whose committed source
 * mutations are still pending. An active repeat drag replaces the older point
 * for that ID; a deleted station may retain only its mask owner and no point.
 */
export function combineGestureSettlementPreview(
  active: GestureProjection | null,
  settlingStationIds: readonly string[],
  settlingStationFeatures: readonly Feature<Point>[],
): GestureProjection | null {
  if (!active && settlingStationIds.length === 0) return null;
  const activeStationIds = new Set(active?.affected.stationIds ?? []);
  const retainedSettlingFeatures = settlingStationFeatures.filter((feature) => {
    const id = feature.properties?.id;
    return typeof id === 'string' && !activeStationIds.has(id);
  });

  return {
    data: {
      type: 'FeatureCollection',
      features: [...retainedSettlingFeatures, ...(active?.data.features ?? [])],
    },
    affected: {
      wayIds: active?.affected.wayIds ?? [],
      stationIds: [...new Set([...settlingStationIds, ...(active?.affected.stationIds ?? [])])],
      facilityIds: active?.affected.facilityIds ?? [],
      groupIds: active?.affected.groupIds ?? [],
      nodeIds: active?.affected.nodeIds ?? [],
    },
  };
}

/**
 * Keeps active and settling geometry in one scratch-source projection. The map
 * integration owns only when to transition; this controller owns the exact
 * feature and mask composition across overlapping gestures and store updates.
 */
export function createStationGesturePreviewController({
  render,
}: StationGesturePreviewControllerOptions): StationGesturePreviewController {
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
    retainCommitted(stationIds, features) {
      for (const stationId of stationIds) settlingIds.add(stationId);
      for (const feature of createStationSettlementPreviewFeatures(features)) {
        const id = feature.properties?.id;
        if (typeof id === 'string') settlingFeatures.set(id, feature);
      }
      active = null;
      return renderCurrent();
    },
    retainActiveStations(stationIds) {
      for (const stationId of stationIds) settlingIds.add(stationId);
      for (const feature of active?.data.features ?? []) {
        const id = feature.properties?.id;
        if (
          feature.geometry.type === 'Point' &&
          feature.properties?.kind === 'station' &&
          typeof id === 'string'
        ) {
          settlingFeatures.set(id, feature as Feature<Point>);
        }
      }
      active = null;
      return renderCurrent();
    },
    syncStations(system) {
      for (const stationId of settlingIds) {
        const station = system.stations.find((candidate) => candidate.id === stationId);
        if (!station) {
          settlingFeatures.delete(stationId);
          continue;
        }
        settlingFeatures.set(stationId, {
          type: 'Feature',
          properties: { kind: 'station', ownerId: stationId, id: stationId },
          geometry: { type: 'Point', coordinates: station.coord },
        });
      }
      return renderCurrent();
    },
    refresh: renderCurrent,
    releaseStations() {
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
