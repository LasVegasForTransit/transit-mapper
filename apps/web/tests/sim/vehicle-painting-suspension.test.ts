import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureCollection } from 'geojson';
import type { Map as MLMap } from 'maplibre-gl';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { defaultProfileFor } from '@transitmapper/core/model/profile';
import { oneSection, wholeLeg } from '@transitmapper/core/model/geo';
import type { Stop, TransitSystem, Way } from '@transitmapper/core/model/system';
import { createEditorStore } from '../../src/editor/store';
import { SRC_VEHICLES, SRC_VEHICLES_INFRA } from '@transitmapper/renderer/layers';
import { createSimClock } from '../../src/sim/simClock';
import { attachVehicleAnimation } from '../../src/sim/vehicles';

interface ScheduledWork {
  raf: Map<number, FrameRequestCallback>;
  pumpFrame: (atMs: number) => void;
}

function installScheduler(): ScheduledWork {
  let nextId = 0;
  let nowMs = 0;
  let raf = new Map<number, FrameRequestCallback>();

  vi.stubGlobal('window', {});
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextId;
    raf.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    raf.delete(id);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

  return {
    get raf() {
      return raf;
    },
    pumpFrame(atMs) {
      nowMs = atMs;
      const due = raf;
      raf = new Map();
      for (const callback of due.values()) callback(atMs);
    },
  };
}

interface SourceProbe {
  updates: FeatureCollection[];
  setData: (data: FeatureCollection) => void;
}

function createMap(): { map: MLMap; network: SourceProbe } {
  const network: SourceProbe = {
    updates: [],
    setData(data) {
      this.updates.push(data);
    },
  };
  return {
    map: {
      getSource(id: string) {
        if (id === SRC_VEHICLES) return network;
        if (id === SRC_VEHICLES_INFRA) return undefined;
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
      on() {},
      off() {},
    } as unknown as MLMap,
    network,
  };
}

function runningSystem(): TransitSystem {
  const system = createEmptySystem();
  const way: Way = {
    id: 'used',
    typeId: 'road',
    points: [
      [-115.2, 36.1],
      [-115.1, 36.1],
    ],
    geometry: 'straight',
    grade: 'atGrade',
    profile: defaultProfileFor('road'),
  };
  const stop: Stop = {
    id: 'used-stop',
    coord: [-115.15, 36.1],
    anchors: [{ wayId: way.id, t: 0.5 }],
  };
  system.ways = [way];
  system.stops = [stop];
  system.services = [
    {
      id: 'service',
      name: 'Line',
      modeId: 'bus',
      frequencyMinutes: 10,
      path: { id: 'service', sections: oneSection([wholeLeg(way.id)]) },
    },
  ];
  return system;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('vehicle painting suspension', () => {
  it('does not write vehicle sources while the editor is covered', () => {
    const scheduled = installScheduler();
    const store = createEditorStore();
    store.commands.document.setSystem(runningSystem());
    const { map, network } = createMap();
    let suspended = true;
    const listeners = new Set<() => void>();

    const detach = attachVehicleAnimation(map, store, createSimClock(), {
      isVisible: () => true,
      viewMode: () => 'network',
      pinnedPeriod: () => undefined,
      isDirectManipulationActive: () => false,
      isPaintingSuspended: () => suspended,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    scheduled.pumpFrame(0);
    scheduled.pumpFrame(40);

    expect(network.updates).toHaveLength(0);
    expect(scheduled.raf.size).toBe(0);

    suspended = false;
    for (const listener of listeners) listener();
    expect(scheduled.raf.size).toBe(1);
    scheduled.pumpFrame(80);
    expect(network.updates).toHaveLength(1);

    detach();
  });
});
