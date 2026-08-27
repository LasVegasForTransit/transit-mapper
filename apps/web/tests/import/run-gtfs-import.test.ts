import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
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

const BATCH: GtfsImportBatch = {
  pieces: { ways: [], lines: [], services: [], stops: [], stations: [] },
  routesDone: 1,
  routesTotal: 1,
};

interface ImportHarness {
  options: StartGtfsImportOptions;
  progress: () => ImportProgress | null;
  appliedBatches: () => number;
}

function importHarness(): ImportHarness {
  const system = createEmptySystem();
  let progress: ImportProgress | null = null;
  let appliedBatches = 0;
  const options: StartGtfsImportOptions = {
    feed: FEED,
    store: {
      getState: () => ({ system, documentStatus: 'ready' }),
      subscribe: () => () => undefined,
    },
    commands: {
      importWays: () => ({ added: 0, skipped: 0 }),
      applyImportedNetwork: () => null,
      importGtfs: () => undefined,
      applyGtfsImportBatch: () => {
        appliedBatches += 1;
        return true;
      },
      reconcileImportedServices: () => 0,
      applyImportedReconciliation: () => true,
    },
    setImportProgress: (update) => {
      progress = typeof update === 'function' ? update(progress) : update;
    },
    onStarted: vi.fn(),
  };
  return { options, progress: () => progress, appliedBatches: () => appliedBatches };
}

async function settleImport(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

afterEach(() => {
  vi.clearAllTimers();
  vi.restoreAllMocks();
});

describe('managed GTFS import operation', () => {
  it('uses the selected feed name throughout agency-neutral progress', async () => {
    harness.stream.mockImplementation(async function* () {
      await Promise.resolve();
      yield BATCH;
    });
    harness.reconcile.mockResolvedValue({});
    const run = importHarness();

    startGtfsImport(run.options);
    expect(run.progress()?.label).toBe('Downloading TriMet…');
    await settleImport();

    expect(run.appliedBatches()).toBe(1);
    expect(run.progress()).toMatchObject({
      label: 'Imported 1 routes from TriMet',
      state: 'done',
    });
  });

  it('keeps an applied batch when cancellation stops the remaining feed', async () => {
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

    expect(run.appliedBatches()).toBe(1);
    expect(run.progress()).toMatchObject({ state: 'canceled' });
    expect(run.progress()?.label).toContain('Routes already added remain in the original system.');
  });
});
