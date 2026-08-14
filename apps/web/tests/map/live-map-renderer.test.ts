import type { FeatureCollection } from 'geojson';
import { describe, expect, it } from 'vitest';
import { SRC_WAYS } from '../../src/map/layers';
import { createLiveMapRenderer, type LiveMapRendererHost } from '../../src/map/live-map-renderer';
import type { FeatureProjectionWorkerClient } from '../../src/map/feature-projection-worker';
import { emptySystemFeatures } from '../../src/map/system-feature-sources';
import type {
  GeoJsonSourceTarget,
  GeoJsonSourceUpdate,
} from '../../src/map/render-scene-source-updater';

const unusedProjectionWorker: FeatureProjectionWorkerClient = {
  project: () => Promise.reject(new Error('This publication test does not project features.')),
  dispose: () => {},
};

class TestSource implements GeoJsonSourceTarget {
  constructor(private readonly onMutation: () => void) {}

  setData(_collection: FeatureCollection): void {
    this.onMutation();
  }

  updateData(_update: GeoJsonSourceUpdate): void {
    this.onMutation();
  }
}

class TestRendererHost implements LiveMapRendererHost {
  private nextFrame = 1;
  private readonly frames = new Map<number, () => void>();
  private readonly loadedSources = new Set<string>();
  private readonly sourceListeners = new Set<(sourceId: string) => void>();
  private readonly renderListeners = new Set<() => void>();
  private readonly sources = new Map<string, TestSource>();
  emitSourceDataOnMutation = false;

  now = (): number => 0;

  scheduleFrame = (callback: () => void): number => {
    const handle = this.nextFrame++;
    this.frames.set(handle, callback);
    return handle;
  };

  cancelFrame = (handle: number): void => {
    this.frames.delete(handle);
  };

  resolveSource = (sourceId: string): TestSource => {
    let source = this.sources.get(sourceId);
    if (!source) {
      source = new TestSource(() => {
        if (!this.emitSourceDataOnMutation) return;
        this.complete(sourceId);
      });
      this.sources.set(sourceId, source);
    }
    return source;
  };

  hasLayer = (): boolean => true;
  setLayerVisibility = (): void => {};
  setLayerPaintProperty = (): void => {};
  triggerRepaint = (): void => {};
  ensureOverlay = (): boolean => true;

  isSourceLoaded = (sourceId: string): boolean => this.loadedSources.has(sourceId);

  onSourceData = (listener: (sourceId: string) => void): (() => void) => {
    this.sourceListeners.add(listener);
    return () => this.sourceListeners.delete(listener);
  };

  onRender = (listener: () => void): (() => void) => {
    this.renderListeners.add(listener);
    return () => this.renderListeners.delete(listener);
  };

  flushFrame(): void {
    const entry = this.frames.entries().next();
    if (entry.done) return;
    const [handle, callback] = entry.value;
    this.frames.delete(handle);
    callback();
  }

  loadKnownSources(): void {
    for (const sourceId of this.sources.keys()) {
      this.complete(sourceId);
    }
  }

  private complete(sourceId: string): void {
    this.loadedSources.add(sourceId);
    for (const listener of this.sourceListeners) listener(sourceId);
  }

  paint(): void {
    for (const listener of [...this.renderListeners]) listener();
  }

  async advance(loadKnownSources = true): Promise<void> {
    this.flushFrame();
    if (loadKnownSources) this.loadKnownSources();
    this.paint();
    await Promise.resolve();
  }
}

async function advanceUntil(
  host: TestRendererHost,
  predicate: () => boolean,
  limit = 200,
  loadKnownSources = true,
): Promise<void> {
  for (let step = 0; step < limit && !predicate(); step += 1) await host.advance(loadKnownSources);
  if (!predicate()) throw new Error('Renderer did not reach the expected lifecycle state.');
}

describe('live map renderer', () => {
  it('keeps the accepted revision authoritative until the replacement paints', async () => {
    const host = new TestRendererHost();
    const renderer = createLiveMapRenderer({
      host,
      layerSpecs: [],
      featureProjectionWorker: unusedProjectionWorker,
    });

    const first = renderer.publishScene({
      revision: 'first',
      features: emptySystemFeatures(),
      sourceIds: [SRC_WAYS],
    });
    await advanceUntil(host, () => renderer.snapshot().acceptedRevision === 'first');
    await first.settled;

    const second = renderer.publishScene({
      revision: 'second',
      features: emptySystemFeatures(),
      sourceIds: [SRC_WAYS],
      intent: 'reset',
    });
    await advanceUntil(host, () => renderer.snapshot().activeRevision === 'second');

    expect(renderer.snapshot().acceptedRevision).toBe('first');

    host.paint();
    await second.settled;
    expect(renderer.snapshot().acceptedRevision).toBe('second');
    renderer.dispose();
  });

  it('subscribes before a hidden-bank source can report its synchronous load', async () => {
    const host = new TestRendererHost();
    host.emitSourceDataOnMutation = true;
    const renderer = createLiveMapRenderer({
      host,
      layerSpecs: [],
      featureProjectionWorker: unusedProjectionWorker,
    });

    const submission = renderer.publishScene({
      revision: 'first',
      features: emptySystemFeatures(),
      sourceIds: [SRC_WAYS],
    });

    await advanceUntil(host, () => renderer.snapshot().acceptedRevision === 'first', 200, false);
    await expect(submission.settled).resolves.toBeUndefined();
    renderer.dispose();
  });
});
