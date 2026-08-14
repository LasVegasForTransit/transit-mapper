import type { SceneDraft } from '../../src/map/scene-draft';
import { emptySystemFeatures } from '../../src/map/system-feature-sources';

/** Deterministic frame driver for scene-publication tests. Publication crosses
 * scheduler frames by design, so tests advance it explicitly instead of using
 * timers or a browser event loop. */
export class ScenePublicationFrameClock {
  nowMs = 0;
  private nextHandle = 1;
  readonly frames = new Map<number, () => void>();
  now = () => this.nowMs;
  scheduleFrame = (callback: () => void) => {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  };
  cancelFrame = (handle: number) => {
    this.frames.delete(handle);
  };
  flush(): void {
    const entry = this.frames.entries().next();
    if (entry.done) throw new Error('No frame is scheduled.');
    const [handle, callback] = entry.value;
    this.frames.delete(handle);
    callback();
  }
}

export const scenePublicationInput = {
  revision: 'scene',
  features: emptySystemFeatures(),
  sourceIds: [],
};
export const preparedSceneDraft = {} as SceneDraft;

export async function flushScenePublication(
  clock: ScenePublicationFrameClock,
  settled: Promise<void>,
): Promise<void> {
  const state = { done: false };
  void settled.then(
    () => {
      state.done = true;
    },
    () => {
      state.done = true;
    },
  );
  for (let index = 0; index < 32; index += 1) {
    await Promise.resolve();
    await Promise.resolve();
    if (state.done) return;
    if (clock.frames.size > 0) clock.flush();
  }
  throw new Error('Scene publication did not settle within 32 frames.');
}
