import type { Feature, FeatureCollection, Point, Polygon } from 'geojson';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import { bearingAtT, pointAtDistance, rotatedRectPolygon } from '@transitmapper/core/model/geo';
import type { LngLat, Service, TransitSystem } from '@transitmapper/core/model/system';
import { roundTripMs } from '@transitmapper/core/sim/timetable';
import { effectiveVehicleKind } from '@transitmapper/core/sim/serviceStats';
import { planService, runStateAt } from '@transitmapper/core/sim/fleet';
import { advanceSimMs, dayScopeAt, minutesOfDay, simSpeed } from '@transitmapper/core/sim/clock';
import {
  lineForService,
  serviceDisplayLabel,
  servicePattern,
} from '@transitmapper/core/model/line-service';
import type { EditorStore } from '../editor/store';
import { SRC_VEHICLES, SRC_VEHICLES_INFRA } from '../map/layers';
import { vehiclesDisabledForPerf } from '../perf';
import { resolvePatternGeometry } from './patternGeometry';
import { nextActiveServiceMs, ScheduleResolver } from './serviceSchedule';
import type { SimClock } from './simClock';

/** Presentation state that controls whether and how vehicles are drawn. */
export interface VehicleGate {
  /** Whether this service's vehicles should render under the mode filter. */
  isVisible: (service: Service) => boolean;
  /** Network draws dots, Infrastructure draws footprints, Diagram draws none. */
  viewMode: () => 'network' | 'infrastructure' | 'diagram';
  /** A pinned schedule period, or undefined to follow the simulated clock. */
  pinnedPeriod: () => string | undefined;
  /** True while map geometry or the camera is being manipulated directly.
   * The host keeps painting against the last settled system until release. */
  isDirectManipulationActive: () => boolean;
  /** Notify the host when any gate value changes. */
  subscribe: (listener: () => void) => () => void;
}

const MAX_VEHICLES_PER_PATTERN = 12;
const VEHICLE_UPDATE_INTERVAL_MS = 1000 / 30;
const MAX_TICK_ADVANCE_MS = 250;
const clampedFleetsReported = new Set<string>();

interface VehicleProps {
  color: string;
}

type VehicleFeature = Feature<Point, VehicleProps>;
type InfrastructureVehicleFeature = Feature<Polygon, VehicleProps>;

interface RenderInputs {
  system: TransitSystem;
  source: GeoJSONSource | undefined;
  infraSource: GeoJSONSource | undefined;
  viewMode: ReturnType<VehicleGate['viewMode']>;
  pinnedPeriod: string | undefined;
  visibleServices: Service[];
  bounds: [number, number, number, number];
  disabledForPerf: boolean;
}

/**
 * A cap controls rendering cost, not service planning. Report it once in
 * development so a sparse-looking line cannot be mistaken for wrong headway.
 */
function noteClampedFleet(patternId: string, serviceName: string, fleet: number): void {
  if (!import.meta.env.DEV || clampedFleetsReported.has(patternId)) return;
  clampedFleetsReported.add(patternId);
  console.info(
    `[sim] ${serviceName}: running ${fleet} vehicles, drawing ${MAX_VEHICLES_PER_PATTERN}. Headway and spacing are unaffected; the map shows gaps.`,
  );
}

/**
 * Attach the MapLibre host for the pure motion kernel in packages/core.
 *
 * The host advances simulated time, resolves visible runs, and writes pooled
 * GeoJSON directly to the vehicle sources. It never mutates the editor store
 * or its undo history.
 */
export function attachVehicleAnimation(
  map: MLMap,
  store: EditorStore,
  clock: SimClock,
  gate: VehicleGate,
): () => void {
  let frame: number | null = null;
  let idleWakeTimer: ReturnType<typeof setTimeout> | null = null;
  let detached = false;
  let paintPausedFrame = false;
  let advancingClock = false;
  let idle = false;
  let lastUpdate = -Infinity;
  let lastRealNow = performance.now();
  let previousClockSettings = clock.settings();
  const manipulationActive = () => gate.isDirectManipulationActive();
  let settledSystem = store.getState().system;
  let manipulationSystem = manipulationActive() ? settledSystem : null;
  const schedules = new ScheduleResolver();

  // Stable feature objects keep per-frame allocation and GC pressure bounded.
  const pool: VehicleFeature[] = [];
  const collection: FeatureCollection<Point, VehicleProps> = {
    type: 'FeatureCollection',
    features: [],
  };
  const infrastructurePool: InfrastructureVehicleFeature[] = [];
  const infrastructureCollection: FeatureCollection<Polygon, VehicleProps> = {
    type: 'FeatureCollection',
    features: [],
  };
  let networkHasData = false;
  let infrastructureHasData = false;

  const readRenderInputs = (): RenderInputs => {
    // Edits publish transient system snapshots on every painted pointer frame.
    // Vehicles keep moving on the last committed geometry during that gesture,
    // then adopt the new system once at release. This preserves continuous
    // feedback without rebuilding route geometry beside every drag update.
    const system = manipulationSystem ?? store.getState().system;
    const bounds = map.getBounds();
    const visibleServices = system.services.filter((service) => gate.isVisible(service));
    return {
      system,
      source: map.getSource(SRC_VEHICLES),
      infraSource: map.getSource(SRC_VEHICLES_INFRA),
      viewMode: gate.viewMode(),
      pinnedPeriod: gate.pinnedPeriod(),
      visibleServices,
      bounds: [bounds.getWest(), bounds.getEast(), bounds.getSouth(), bounds.getNorth()],
      disabledForPerf: vehiclesDisabledForPerf(),
    };
  };

  const cancelScheduled = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    if (idleWakeTimer !== null) {
      clearTimeout(idleWakeTimer);
      idleWakeTimer = null;
    }
  };

  const scheduleFrame = (allowPaused = false) => {
    if (allowPaused) paintPausedFrame = true;
    if (detached || frame !== null || (clock.settings().paused && !allowPaused)) return;
    if (idleWakeTimer !== null) {
      clearTimeout(idleWakeTimer);
      idleWakeTimer = null;
    }
    frame = requestAnimationFrame(tick);
  };

  const wake = (allowPaused = false) => {
    if (detached || (clock.settings().paused && !allowPaused)) return;
    scheduleFrame(allowPaused);
  };

  const setNetworkData = (
    source: GeoJSONSource | undefined,
    features: FeatureCollection<Point, VehicleProps>,
  ) => {
    const hasData = features.features.length > 0;
    if (hasData || networkHasData) source?.setData(features);
    networkHasData = hasData;
  };

  const setInfrastructureData = (
    source: GeoJSONSource | undefined,
    features: FeatureCollection<Polygon, VehicleProps>,
  ) => {
    const hasData = features.features.length > 0;
    if (hasData || infrastructureHasData) source?.setData(features);
    infrastructureHasData = hasData;
  };

  const clearSources = (source?: GeoJSONSource, infraSource?: GeoJSONSource) => {
    if (collection.features.length !== 0) collection.features.length = 0;
    if (infrastructureCollection.features.length !== 0)
      infrastructureCollection.features.length = 0;
    setNetworkData(source, collection);
    setInfrastructureData(infraSource, infrastructureCollection);
  };

  function tick() {
    frame = null;
    const paused = clock.settings().paused;
    const canPaintPaused = paintPausedFrame;
    paintPausedFrame = false;
    if (detached || (paused && !canPaintPaused)) return;

    const wokeFromIdle = idle;
    idle = false;
    const realNow = performance.now();

    const sinceLast = realNow - lastUpdate;
    if (!paused && sinceLast < VEHICLE_UPDATE_INTERVAL_MS) {
      idle = wokeFromIdle;
      scheduleFrame();
      return;
    }
    lastUpdate = realNow;

    // Hidden-tab time is intentionally excluded. A visible dropped frame can
    // advance at most MAX_TICK_ADVANCE_MS unless this was an intentional idle.
    const realDelta = Math.max(0, realNow - lastRealNow);
    lastRealNow = realNow;
    advancingClock = !paused;
    const simMs = paused
      ? clock.now()
      : clock.advance(wokeFromIdle ? realDelta : Math.min(realDelta, MAX_TICK_ADVANCE_MS));
    advancingClock = false;

    const inputs = readRenderInputs();
    const { source, infraSource } = inputs;
    if (!source && !infraSource) {
      idle = true;
      return;
    }
    if (inputs.disabledForPerf) {
      clearSources(source, infraSource);
      idle = true;
      return;
    }

    const { system, viewMode } = inputs;
    if (viewMode === 'diagram') {
      clearSources(source, infraSource);
      idle = true;
      return;
    }

    // Cull against a half-viewport margin so vehicles appear before their
    // route reaches the bezel.
    const [west, east, south, north] = inputs.bounds;
    const spanLng = east - west;
    const spanLat = north - south;
    const cullW = west - spanLng * 0.5;
    const cullE = east + spanLng * 0.5;
    const cullS = south - spanLat * 0.5;
    const cullN = north + spanLat * 0.5;

    let used = 0;
    let infrastructureUsed = 0;
    const emit = (coord: LngLat, color: string) => {
      const existing = pool[used];
      if (existing) {
        existing.properties.color = color;
        existing.geometry.coordinates[0] = coord[0];
        existing.geometry.coordinates[1] = coord[1];
      } else {
        pool[used] = {
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Point', coordinates: [coord[0], coord[1]] },
        };
      }
      used++;
    };

    const emitInfrastructure = (
      coord: LngLat,
      bearing: number,
      widthM: number,
      lengthM: number,
      color: string,
    ) => {
      const ring = rotatedRectPolygon(coord, bearing, widthM, lengthM);
      const existing = infrastructurePool[infrastructureUsed];
      if (existing) {
        existing.properties.color = color;
        const target = existing.geometry.coordinates[0];
        target.length = ring.length;
        for (let i = 0; i < ring.length; i++) {
          const point = target[i];
          if (point) {
            point[0] = ring[i][0];
            point[1] = ring[i][1];
          } else {
            target[i] = [ring[i][0], ring[i][1]];
          }
        }
      } else {
        infrastructurePool[infrastructureUsed] = {
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Polygon', coordinates: [ring] },
        };
      }
      infrastructureUsed++;
    };

    const running = schedules.resolve(
      system.services,
      minutesOfDay(simMs),
      dayScopeAt(simMs),
      inputs.pinnedPeriod,
    );
    let hasActiveService = false;

    for (const service of inputs.visibleServices) {
      const active = running.get(service.id);
      if (!active) continue;
      hasActiveService = true;
      const { widthM, lengthM, profile } = effectiveVehicleKind(system.vehicleKinds, service);

      const pattern = servicePattern(service);
      const color = lineForService(system, service.id)?.color ?? '#4b5563';
      const geometry = resolvePatternGeometry(
        system,
        pattern,
        profile,
        viewMode === 'infrastructure' ? service.modeId : undefined,
      );
      if (!geometry) continue;
      const bounds = geometry.bbox;
      if (bounds[2] < cullW || bounds[0] > cullE || bounds[3] < cullS || bounds[1] > cullN)
        continue;

      const plan = planService(
        roundTripMs(geometry.timetables),
        active.headwayMinutes === undefined ? undefined : active.headwayMinutes * 60_000,
      );
      // The true plan retains its fleet and cycle. The cap only selects how
      // many of those runs are drawn.
      const shown = Math.min(plan.fleet, MAX_VEHICLES_PER_PATTERN);
      if (shown < plan.fleet)
        noteClampedFleet(pattern.id, serviceDisplayLabel(system, service.id), plan.fleet);

      for (let i = 0; i < shown; i++) {
        const { distMeters, run } = runStateAt(simMs, geometry.timetables, plan, i, profile);
        const { path, cumLengths, meters: legMeters } = geometry[run];
        const along = Math.min(distMeters, legMeters);
        const t = legMeters > 0 ? along / legMeters : 0;
        const center = pointAtDistance(path, cumLengths, along);

        if (viewMode === 'network') {
          emit(center, color);
        } else {
          emitInfrastructure(center, bearingAtT(path, t, legMeters), widthM, lengthM, color);
        }
      }
    }

    if (collection.features.length !== used) collection.features.length = used;
    for (let i = 0; i < used; i++) collection.features[i] = pool[i];
    if (infrastructureCollection.features.length !== infrastructureUsed)
      infrastructureCollection.features.length = infrastructureUsed;
    for (let i = 0; i < infrastructureUsed; i++)
      infrastructureCollection.features[i] = infrastructurePool[i];
    setNetworkData(source, collection);
    setInfrastructureData(infraSource, infrastructureCollection);

    if (paused) {
      idle = true;
    } else if (used > 0 || infrastructureUsed > 0) {
      scheduleFrame();
    } else {
      idle = true;
      if (
        !hasActiveService &&
        inputs.visibleServices.length > 0 &&
        inputs.pinnedPeriod === undefined
      ) {
        const nextActive = nextActiveServiceMs(inputs.visibleServices, simMs);
        if (nextActive !== null) {
          const realDelay = (nextActive - simMs) / simSpeed(clock.settings().speedId).simPerReal;
          idleWakeTimer = setTimeout(() => {
            idleWakeTimer = null;
            wake();
          }, Math.ceil(realDelay));
        }
      }
    }
  }

  const unsubscribeSettings = clock.subscribeSettings((settings) => {
    const realNow = performance.now();
    if (!previousClockSettings.paused) {
      // Settle the visible interval under the previous speed before installing
      // a pause or speed change.
      const before = clock.now();
      const caughtUp = advanceSimMs(
        before,
        Math.max(0, realNow - lastRealNow),
        simSpeed(previousClockSettings.speedId).simPerReal,
      );
      if (caughtUp !== before) {
        advancingClock = true;
        clock.setTime(caughtUp);
        advancingClock = false;
      }
    }
    previousClockSettings = settings;
    lastRealNow = realNow;
    lastUpdate = -Infinity;
    cancelScheduled();
    if (settings.paused) {
      scheduleFrame(true);
      return;
    }
    wake();
  });

  const unsubscribeTime = clock.subscribe(() => {
    if (advancingClock) return;
    // setTime establishes the new real-time baseline for the selected instant.
    lastRealNow = performance.now();
    lastUpdate = -Infinity;
    wake(clock.settings().paused);
  });

  let previousSystem = settledSystem;
  const unsubscribeStore = store.subscribe((state) => {
    if (state.system === previousSystem) return;
    previousSystem = state.system;
    // Transient edit snapshots are intentionally ignored by the vehicle
    // geometry cache. The existing rAF loop continues painting and advancing
    // time from manipulationSystem until the gate commits the new snapshot.
    if (manipulationActive()) return;
    settledSystem = state.system;
    wake(true);
  });

  const wakeForCamera = () => {
    wake(true);
  };
  map.on('moveend', wakeForCamera);
  map.on('zoomend', wakeForCamera);

  let manipulationWasActive = manipulationActive();
  const unsubscribeGate = gate.subscribe(() => {
    const manipulationIsActive = manipulationActive();
    if (manipulationIsActive && !manipulationWasActive) {
      manipulationSystem = settledSystem;
    } else if (!manipulationIsActive && manipulationWasActive) {
      settledSystem = store.getState().system;
      manipulationSystem = null;
    }
    manipulationWasActive = manipulationIsActive;
    wake(true);
  });

  const onVisibilityChange = () => {
    const realNow = performance.now();
    if (document.visibilityState === 'hidden' && !clock.settings().paused) {
      advancingClock = true;
      clock.advance(Math.max(0, realNow - lastRealNow));
      advancingClock = false;
    }
    lastRealNow = realNow;
    lastUpdate = -Infinity;
  };
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', onVisibilityChange);

  scheduleFrame(clock.settings().paused);
  return () => {
    detached = true;
    cancelScheduled();
    unsubscribeSettings();
    unsubscribeTime();
    unsubscribeStore();
    unsubscribeGate();
    map.off('moveend', wakeForCamera);
    map.off('zoomend', wakeForCamera);
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
