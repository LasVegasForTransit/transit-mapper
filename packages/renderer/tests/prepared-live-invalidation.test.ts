import { describe, expect, it } from 'vitest';
import type { RenderDependencyClosure } from '@transitmapper/core/render/dependency-index';
import type { RenderPreparedSnapshot } from '@transitmapper/core/render/render-preparation';
import { createPreparedLiveInvalidationTracker } from '../src/projection/entity-render-update';

const EMPTY: RenderDependencyClosure = {
  corridorIds: [],
  junctionIds: [],
  connectorJunctionIds: [],
  serviceSpanIds: [],
  stopIds: [],
  stationIds: [],
  labelIds: [],
};

function snapshot(
  generation: number,
  invalidation: RenderDependencyClosure,
  fullProjectionReason?: RenderPreparedSnapshot['fullProjectionReason'],
): RenderPreparedSnapshot {
  return {
    generation,
    invalidation,
    ...(fullProjectionReason ? { fullProjectionReason } : {}),
  } as RenderPreparedSnapshot;
}

describe('prepared live invalidation tracking', () => {
  it('retains a canceled edit through a later camera preparation until paint accepts it', () => {
    const tracker = createPreparedLiveInvalidationTracker();
    const edited = snapshot(1, { ...EMPTY, corridorIds: ['edited-way'] });
    const camera = snapshot(2, EMPTY);

    tracker.record(edited);
    expect(tracker.record(camera).invalidation?.corridorIds).toEqual(['edited-way']);

    tracker.accept(camera);
    expect(tracker.current()).toEqual({});
  });

  it('merges chained canceled edits in stable order', () => {
    const tracker = createPreparedLiveInvalidationTracker();
    tracker.record(snapshot(1, { ...EMPTY, corridorIds: ['a', 'shared'] }));
    const current = tracker.record(
      snapshot(2, { ...EMPTY, corridorIds: ['shared', 'b'], stationIds: ['station'] }),
    );

    expect(current.invalidation).toMatchObject({
      corridorIds: ['a', 'shared', 'b'],
      stationIds: ['station'],
    });
  });

  it('retains a cold full-projection reason until its scene is accepted', () => {
    const tracker = createPreparedLiveInvalidationTracker();
    const serviceEdit = snapshot(1, EMPTY, 'service-bundle-allocation');

    expect(tracker.record(serviceEdit)).toEqual({
      fullProjectionReason: 'service-bundle-allocation',
    });
    tracker.accept(serviceEdit);
    expect(tracker.current()).toEqual({});
  });
});
