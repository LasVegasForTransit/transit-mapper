import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { aPattern, aRoad, aService } from '@transitmapper/core/testing/fixtures';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { GtfsImportBatch } from '@transitmapper/core/model/gtfsImport';
import type { ImportProgress } from '../../src/ui/UiProvider';
import { startGtfsImport, type StartGtfsImportOptions } from '../../src/import/run-gtfs-import';

const harness = vi.hoisted(() => ({
  stream: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock('../../src/import/stream-gtfs-feed', () => ({
  streamGtfsFeedBatches: harness.stream,
}));

vi.mock('../../src/import/reconcile-gtfs', () => ({
  reconcileGtfs: harness.reconcile,
}));

const FEED = {
  slug: 'trimet',
  name: 'TriMet',
  region: 'Portland, Oregon',
};

const IMPORTED_WAY = aRoad('imported-way', [
  [-115.16, 36.14],
  [-115.12, 36.14],
]);
const IMPORTED_SERVICE = aService('imported-service', [
  aPattern('imported-pattern', [IMPORTED_WAY], [IMPORTED_WAY.id]),
]);

const BATCH: GtfsImportBatch = {
  pieces: {
    ways: [IMPORTED_WAY],
    lines: [
      {
        id: 'imported-line',
        name: 'Imported line',
        color: '#123456',
        serviceIds: [IMPORTED_SERVICE.id],
      },
    ],
    services: [IMPORTED_SERVICE],
    stops: [],
    stations: [],
  },
  routesDone: 1,
  routesTotal: 1,
};

interface ImportHarness {
  options: StartGtfsImportOptions;
  progress: () => ImportProgress | null;
  system: () => TransitSystem;
  completedImports: () => number;
  interruptNextPublication: () => void;
}

function importHarness(): ImportHarness {
  let system = createEmptySystem();
  let progress: ImportProgress | null = null;
  let completedImports = 0;
  let interruptNextPublication = false;
  const listeners = new Set<
    (
      state: { system: TransitSystem; documentStatus: 'ready' },
      previous: { system: TransitSystem; documentStatus: 'ready' },
    ) => void
  >();
  const replaceSystem = (next: TransitSystem) => {
    const previous = system;
    system = next;
    for (const listener of listeners) {
      listener({ system, documentStatus: 'ready' }, { system: previous, documentStatus: 'ready' });
    }
  };
  const options: StartGtfsImportOptions = {
    feed: FEED,
    store: {
      getState: () => ({ system, documentStatus: 'ready' }),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    commands: {
      importWays: () => ({ added: 0, skipped: 0 }),
      applyImportedNetwork: () => null,
      applyCompletedGtfsImport: ({
        expectedSystem,
        result,
      }: {
        expectedSystem: TransitSystem;
        result: { system: TransitSystem };
      }) => {
        if (interruptNextPublication) {
          interruptNextPublication = false;
          replaceSystem({ ...system, name: 'Edited while importing' });
          return false;
        }
        if (system !== expectedSystem) return false;
        completedImports += 1;
        replaceSystem(result.system);
        return true;
      },
      reconcileImportedServices: () => 0,
    },
    setImportProgress: (update) => {
      progress = typeof update === 'function' ? update(progress) : update;
    },
    onStarted: vi.fn(),
  };
  return {
    options,
    progress: () => progress,
    system: () => system,
    completedImports: () => completedImports,
    interruptNextPublication: () => {
      interruptNextPublication = true;
    },
  };
}

async function settleImport(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('managed GTFS import operation', () => {
  it('uses the selected feed name throughout agency-neutral progress', async () => {
    harness.stream.mockImplementation(async function* () {
      await Promise.resolve();
      yield BATCH;
    });
    harness.reconcile.mockImplementation((system: TransitSystem) =>
      Promise.resolve({ system, reconciled: 0 }),
    );
    const run = importHarness();

    startGtfsImport(run.options);
    expect(run.progress()?.label).toBe('Downloading TriMet…');
    await settleImport();

    expect(run.completedImports()).toBe(1);
    expect(run.system().lines.map(({ id }) => id)).toEqual(['imported-line']);
    expect(run.progress()).toMatchObject({
      label: 'Imported 1 routes from TriMet',
      state: 'done',
    });
  });

  it('discards the candidate when cancellation stops the remaining feed', async () => {
    harness.stream.mockImplementation(async function* (options: { signal?: AbortSignal }) {
      yield BATCH;
      await new Promise<never>((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          () => {
            reject(new DOMException('TriMet import canceled by the user.', 'AbortError'));
          },
          { once: true },
        );
      });
    });
    const run = importHarness();

    startGtfsImport(run.options);
    await settleImport();
    run.progress()?.cancel?.();
    await settleImport();

    expect(run.completedImports()).toBe(0);
    expect(run.system().lines).toEqual([]);
    expect(run.progress()).toMatchObject({ state: 'canceled' });
    expect(run.progress()?.label).not.toContain('Routes already added remain');
  });

  it('rebuilds the candidate from the edited document before publishing it', async () => {
    vi.useFakeTimers();
    harness.stream.mockImplementation(async function* () {
      await Promise.resolve();
      yield BATCH;
    });
    harness.reconcile.mockImplementation((system: TransitSystem) =>
      Promise.resolve({ system, reconciled: 0 }),
    );
    const run = importHarness();
    run.interruptNextPublication();

    startGtfsImport(run.options);
    await settleImport();

    expect(run.progress()?.label).toBe('Waiting for editing to settle before merging routes…');
    await vi.advanceTimersByTimeAsync(500);
    await settleImport();

    expect(run.completedImports()).toBe(1);
    expect(run.system().name).toBe('Edited while importing');
    expect(run.system().lines.map(({ id }) => id)).toEqual(['imported-line']);
    expect(run.progress()).toMatchObject({
      label: 'Imported 1 routes from TriMet',
      state: 'done',
    });
  });
});
