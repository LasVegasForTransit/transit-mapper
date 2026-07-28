import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureCollection } from 'geojson';
import type { Map as MLMap } from 'maplibre-gl';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import type { Station, TransitSystem, Way } from '@transitmapper/core/model/system';
import { createEditorStore } from '../editor/store';
import { SRC_VEHICLES, SRC_VEHICLES_INFRA } from '../map/layers';
import { createSimClock } from './simClock';

const patternStatsProbe = vi.hoisted(() => ({ calls: 0 }));
const patternDependenciesProbe = vi.hoisted(() => ({ calls: 0 }));

vi.mock('@transitmapper/core/sim/serviceStats', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@transitmapper/core/sim/serviceStats')>();
  return {
    ...actual,
    patternStats: (...args: Parameters<typeof actual.patternStats>) => {
      patternStatsProbe.calls++;
      return actual.patternStats(...args);
    },
  };
});

vi.mock('@transitmapper/core/model/geo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@transitmapper/core/model/geo')>();
  return {
    ...actual,
    patternWayIds: (...args: Parameters<typeof actual.patternWayIds>) => {
      patternDependenciesProbe.calls++;
      return actual.patternWayIds(...args);
    },
  };
});

import { attachVehicleAnimation } from './vehicles';

interface ScheduledWork {
  raf: Map<number, FrameRequestCallback>;
  timers: Map<number, () => void>;
  pumpFrame: (atMs: number) => void;
  setNow: (atMs: number) => void;
}

function installScheduler(): ScheduledWork {
  let nextId = 0;
  let nowMs = 0;
  let raf = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, () => void>();

  vi.stubGlobal('window', {});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextId;
    raf.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    raf.delete(id);
  });
  vi.stubGlobal('setTimeout', (callback: () => void) => {
    const id = ++nextId;
    timers.set(id, callback);
    return id;
  });
  vi.stubGlobal('clearTimeout', (id: number) => {
    timers.delete(id);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

  return {
    get raf() {
      return raf;
    },
    timers,
    pumpFrame(atMs) {
      nowMs = atMs;
      const due = raf;
      raf = new Map();
      for (const callback of due.values()) callback(atMs);
    },
    setNow(atMs) {
      nowMs = atMs;
    },
  };
}

interface SourceProbe {
  updates: FeatureCollection[];
  setData: (data: FeatureCollection) => void;
}

function createMap() {
  const network: SourceProbe = {
    updates: [],
    setData(data) {
      this.updates.push(data);
    },
  };
  const infrastructure: SourceProbe = {
    updates: [],
    setData(data) {
      this.updates.push(data);
    },
  };
  const listeners = new Map<string, Set<() => void>>();
  const map = {
    getSource(id: string) {
      if (id === SRC_VEHICLES) return network;
      if (id === SRC_VEHICLES_INFRA) return infrastructure;
      return undefined;
    },
    getBounds() {
      return {
        getWest: () => -116,
        getEast: () => -114,
        getSouth: () => 35,
        getNorth: () => 37,
      };
    },
    on(type: string, listener: () => void) {
      const current = listeners.get(type) ?? new Set();
      current.add(listener);
      listeners.set(type, current);
    },
    off(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };
  return { map: map as unknown as MLMap, network, infrastructure };
}

function createGate(
  options: {
    visible?: boolean;
    viewMode?: 'network' | 'infrastructure' | 'diagram';
    pinnedPeriod?: string;
    directManipulationActive?: boolean;
  } = {},
) {
  let visible = options.visible ?? true;
  let viewMode = options.viewMode ?? 'network';
  let pinnedPeriod = options.pinnedPeriod;
  let directManipulationActive = options.directManipulationActive ?? false;
  const listeners = new Set<() => void>();
  const invalidate = () => {
    for (const listener of listeners) listener();
  };
  return {
    isVisible: () => visible,
    viewMode: () => viewMode,
    pinnedPeriod: () => pinnedPeriod,
    isDirectManipulationActive: () => directManipulationActive,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setVisible(next: boolean) {
      visible = next;
      invalidate();
    },
    setViewMode(next: 'network' | 'infrastructure' | 'diagram') {
      viewMode = next;
      invalidate();
    },
    setPinnedPeriod(next: string | undefined) {
      pinnedPeriod = next;
      invalidate();
    },
    setDirectManipulationActive(next: boolean) {
      directManipulationActive = next;
      invalidate();
    },
  };
}

function way(id: string, lat: number): Way {
  return {
    id,
    typeId: 'road',
    points: [
      [-115.2, lat],
      [-115.1, lat],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
  };
}

function station(id: string, wayId: string, lat: number): Station {
  return {
    id,
    coord: [-115.15, lat],
    anchors: [{ wayId, t: 0.5 }],
  };
}

function runningSystem(): TransitSystem {
  const system = createEmptySystem();
  const used = way('used', 36.1);
  const unrelated = way('unrelated', 36.3);
  system.ways = [used, unrelated];
  system.stations = [
    station('used-stop', used.id, 36.1),
    station('other-stop', unrelated.id, 36.3),
  ];
  system.services = [
    {
      id: 'service',
      name: 'Line',
      modeId: 'bus',
      color: '#c33',
      frequencyMinutes: 10,
      patterns: [{ id: 'pattern', sections: oneSection([wholeLeg(used.id)]) }],
    },
  ];
  return system;
}

beforeEach(() => {
  patternStatsProbe.calls = 0;
  patternDependenciesProbe.calls = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('vehicle animation scheduling', () => {
  it('a paused simulator paints one frozen frame and remains unscheduled until invalidated', () => {
    const scheduled = installScheduler();
    const store = createEditorStore();
    store.getState().setSystem(runningSystem());
    const clock = createSimClock({ paused: true });
    const { map, network } = createMap();
    const gate = createGate();
    const frozenAt = clock.now();

    const detach = attachVehicleAnimation(map, store, clock, gate);

    expect(scheduled.raf.size).toBe(1);
    scheduled.pumpFrame(0);
    expect(network.updates).toHaveLength(1);
    expect(scheduled.raf.size).toBe(0);
    expect(scheduled.timers.size).toBe(0);

    scheduled.setNow(10_000);
    gate.setPinnedPeriod('Peak');
    expect(scheduled.raf.size).toBe(1);
    scheduled.pumpFrame(10_000);
    expect(network.updates).toHaveLength(2);
    expect(clock.now()).toBe(frozenAt);
    expect(scheduled.raf.size).toBe(0);
    expect(scheduled.timers.size).toBe(0);

    scheduled.setNow(20_000);
    clock.setSettings({ ...clock.settings(), paused: false });
    expect(scheduled.raf.size).toBe(1);
    scheduled.pumpFrame(20_100);
    expect(clock.now()).toBe(frozenAt + 6_000);

    detach();
  });

  it('an empty running simulator stays unscheduled and catches up when data arrives', () => {
    const scheduled = installScheduler();
    const store = createEditorStore();
    store.getState().setSystem(createEmptySystem());
    const clock = createSimClock();
    const startedAt = clock.now();
    const { map, network, infrastructure } = createMap();
    const gate = createGate();

    const detach = attachVehicleAnimation(map, store, clock, gate);
    scheduled.pumpFrame(0);

    expect(network.updates).toHaveLength(0);
    expect(infrastructure.updates).toHaveLength(0);
    expect(scheduled.raf.size).toBe(0);
    expect(scheduled.timers.size).toBe(0);

    scheduled.setNow(5_000);
    store.getState().setSystem(runningSystem());
    expect(scheduled.raf.size).toBe(1);
    scheduled.pumpFrame(5_000);
    expect(network.updates).toHaveLength(1);
    expect(clock.now()).toBe(startedAt + 300_000);

    detach();
  });

  it('an idle clock accounts for visible time before pausing but not paused time', () => {
    const scheduled = installScheduler();
    const store = createEditorStore();
    store.getState().setSystem(createEmptySystem());
    const clock = createSimClock();
    const startedAt = clock.now();
    const { map } = createMap();
    const gate = createGate();

    const detach = attachVehicleAnimation(map, store, clock, gate);
    scheduled.pumpFrame(0);
    expect(scheduled.raf.size).toBe(0);

    scheduled.setNow(5_000);
    clock.setSettings({ ...clock.settings(), paused: true });
    scheduled.pumpFrame(5_000);
    expect(clock.now()).toBe(startedAt + 300_000);
    expect(scheduled.raf.size).toBe(0);

    scheduled.setNow(10_000);
    clock.setSettings({ ...clock.settings(), paused: false });
    scheduled.pumpFrame(10_100);
    expect(clock.now()).toBe(startedAt + 306_000);

    detach();
  });

  it('diagram mode stays unscheduled and wakes when the view changes', () => {
    const scheduled = installScheduler();
    const store = createEditorStore();
    store.getState().setSystem(runningSystem());
    const clock = createSimClock();
    const startedAt = clock.now();
    const { map, network } = createMap();
    const gate = createGate({ viewMode: 'diagram' });

    const detach = attachVehicleAnimation(map, store, clock, gate);
    scheduled.pumpFrame(0);
    expect(network.updates).toHaveLength(0);
    expect(scheduled.raf.size).toBe(0);
    expect(scheduled.timers.size).toBe(0);

    scheduled.setNow(2_000);
    gate.setViewMode('network');
    expect(scheduled.raf.size).toBe(1);
    scheduled.pumpFrame(2_000);
    expect(network.updates).toHaveLength(1);
    expect(clock.now()).toBe(startedAt + 120_000);

    detach();
  });

  it('a filtered-out simulation stays unscheduled and wakes when filters change', () => {
    const scheduled = installScheduler();
    const store = createEditorStore();
    store.getState().setSystem(runningSystem());
    const { map, network } = createMap();
    const gate = createGate({ visible: false });

    const detach = attachVehicleAnimation(map, store, createSimClock(), gate);
    scheduled.pumpFrame(0);
    expect(network.updates).toHaveLength(0);
    expect(scheduled.raf.size).toBe(0);
    expect(scheduled.timers.size).toBe(0);

    gate.setVisible(true);
    expect(scheduled.raf.size).toBe(1);
    scheduled.pumpFrame(40);
    expect(network.updates).toHaveLength(1);

    detach();
  });

  it('an inactive service wakes when its future span begins', () => {
    const scheduled = installScheduler();
    const store = createEditorStore();
    const system = runningSystem();
    system.services[0] = {
      ...system.services[0],
      spanStart: '05:00',
      spanEnd: '23:00',
    };
    store.getState().setSystem(system);
    const minuteMs = 60_000;
    const clock = createSimClock({
      startMs: (4 * 60 + 59) * minuteMs,
      speedId: '1x',
    });
    const { map, network } = createMap();
    const gate = createGate();

    const detach = attachVehicleAnimation(map, store, clock, gate);
    scheduled.pumpFrame(0);

    expect(network.updates).toHaveLength(0);
    expect(scheduled.raf.size).toBe(0);
    expect(scheduled.timers.size).toBe(1);

    scheduled.setNow(1_000);
    [...scheduled.timers.values()][0]();
    expect(scheduled.raf.size).toBe(1);
    scheduled.pumpFrame(1_000);

    expect(clock.now()).toBe(5 * 60 * minuteMs);
    expect(network.updates).toHaveLength(1);
    expect(network.updates[0].features.length).toBeGreaterThan(0);

    detach();
  });

  it('network animation does not rewrite an already-empty infrastructure source', () => {
    const scheduled = installScheduler();
    const store = createEditorStore();
    store.getState().setSystem(runningSystem());
    const { map, network, infrastructure } = createMap();
    const gate = createGate();

    const detach = attachVehicleAnimation(map, store, createSimClock(), gate);
    scheduled.pumpFrame(0);

    expect(network.updates).toHaveLength(1);
    expect(network.updates[0].features.length).toBeGreaterThan(0);
    expect(infrastructure.updates).toHaveLength(0);

    detach();
  });

  it('keeps vehicles moving on settled geometry until direct manipulation commits', () => {
    const scheduled = installScheduler();
    const store = createEditorStore();
    store.getState().setSystem(runningSystem());
    const clock = createSimClock({ speedId: 'realtime' });
    const startedAt = clock.now();
    const { map, network } = createMap();
    const gate = createGate();

    const detach = attachVehicleAnimation(map, store, clock, gate);
    scheduled.pumpFrame(0);
    expect(network.updates).toHaveLength(1);

    gate.setDirectManipulationActive(true);

    expect(network.updates).toHaveLength(1);
    expect(scheduled.raf.size).toBe(1);
    expect(clock.now()).toBe(startedAt);

    map.fire('moveend');
    expect(scheduled.raf.size).toBe(1);

    scheduled.setNow(240);
    const system = store.getState().system;
    store.getState().setSystem({
      ...system,
      ways: system.ways.map((candidate) =>
        candidate.id === 'used'
          ? {
              ...candidate,
              points: candidate.points.map(([lng]) => [lng, 36.2] as [number, number]),
            }
          : candidate,
      ),
    });
    scheduled.pumpFrame(240);

    expect(network.updates).toHaveLength(2);
    expect(clock.now()).toBe(startedAt + 240);
    const duringGesture = network.updates[network.updates.length - 1].features[0];
    expect(duringGesture.geometry.type).toBe('Point');
    if (duringGesture.geometry.type !== 'Point') throw new Error('Expected a vehicle point');
    expect(duringGesture.geometry.coordinates[1]).toBeCloseTo(36.1);

    scheduled.setNow(480);
    gate.setDirectManipulationActive(false);
    expect(scheduled.raf.size).toBe(1);
    scheduled.pumpFrame(480);

    expect(network.updates).toHaveLength(3);
    expect(clock.now()).toBe(startedAt + 480);
    const afterCommit = network.updates[network.updates.length - 1].features[0];
    expect(afterCommit.geometry.type).toBe('Point');
    if (afterCommit.geometry.type !== 'Point') throw new Error('Expected a vehicle point');
    expect(afterCommit.geometry.coordinates[1]).toBeCloseTo(36.2);

    detach();
  });
});

describe('vehicle geometry dependencies', () => {
  it('does not rebuild pattern dependency lists on geometry cache hits', () => {
    const scheduled = installScheduler();
    const store = createEditorStore();
    store.getState().setSystem(runningSystem());
    const { map } = createMap();
    const gate = createGate();

    const detach = attachVehicleAnimation(map, store, createSimClock(), gate);
    scheduled.pumpFrame(0);
    scheduled.pumpFrame(40);
    scheduled.pumpFrame(80);
    scheduled.pumpFrame(120);

    expect(patternStatsProbe.calls).toBe(1);
    expect(patternDependenciesProbe.calls).toBe(1);

    const system = store.getState().system;
    store.getState().setSystem({
      ...system,
      ways: [system.ways[0], { ...system.ways[1] }],
    });
    scheduled.pumpFrame(160);
    scheduled.pumpFrame(200);
    scheduled.pumpFrame(240);

    expect(patternStatsProbe.calls).toBe(1);
    expect(patternDependenciesProbe.calls).toBe(1);

    detach();
  });

  it('editing unrelated ways and stations preserves a pattern geometry cache entry', () => {
    const scheduled = installScheduler();
    const store = createEditorStore();
    store.getState().setSystem(runningSystem());
    const { map } = createMap();
    const gate = createGate();

    const detach = attachVehicleAnimation(map, store, createSimClock(), gate);
    scheduled.pumpFrame(0);
    expect(patternStatsProbe.calls).toBe(1);

    const first = store.getState().system;
    store.getState().setSystem({
      ...first,
      ways: [first.ways[0], { ...first.ways[1] }],
    });
    scheduled.pumpFrame(40);
    expect(patternStatsProbe.calls).toBe(1);

    const second = store.getState().system;
    store.getState().setSystem({
      ...second,
      stations: [second.stations[0], { ...second.stations[1], name: 'Other stop' }],
    });
    scheduled.pumpFrame(80);
    expect(patternStatsProbe.calls).toBe(1);

    const third = store.getState().system;
    store.getState().setSystem({
      ...third,
      stations: [{ ...third.stations[0], dwellSeconds: 45 }, third.stations[1]],
    });
    scheduled.pumpFrame(120);
    expect(patternStatsProbe.calls).toBe(2);

    detach();
  });
});
