import { describe, expect, it, vi } from 'vitest';
import { createMapViewStore } from '../src/index';

const INITIAL_STATE = {
  schemaVersion: 1,
  camera: { center: [-115.1728, 36.1147] as [number, number], zoom: 11 },
  representationId: 'network',
  filters: {
    landmarks: true,
    modes: ['bus', 'rail'],
  },
} as const;

describe('createMapViewStore', () => {
  it('owns an immutable copy of its initial presentation state', () => {
    const input = {
      ...INITIAL_STATE,
      camera: { center: [...INITIAL_STATE.camera.center] as [number, number], zoom: 11 },
      filters: { landmarks: true, modes: [...INITIAL_STATE.filters.modes] as string[] },
    };
    const store = createMapViewStore(input);

    input.camera.center[0] = 0;
    input.filters.modes.push('ferry');

    expect(store.getSnapshot()).toEqual(INITIAL_STATE);
    expect(Object.isFrozen(store.getSnapshot())).toBe(true);
    expect(Object.isFrozen(store.getSnapshot().camera.center)).toBe(true);
    expect(Object.isFrozen(store.getSnapshot().filters.modes)).toBe(true);
  });

  it('publishes one snapshot when the camera changes', () => {
    const store = createMapViewStore(INITIAL_STATE);
    const listener = vi.fn();
    const filters = store.getSnapshot().filters;
    store.subscribe(listener);

    store.setCamera({ center: [-73.9857, 40.7484], zoom: 13 });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(store.getSnapshot());
    expect(store.getSnapshot().camera).toEqual({ center: [-73.9857, 40.7484], zoom: 13 });
    expect(store.getSnapshot().filters).toBe(filters);
  });

  it('does not publish an equivalent camera', () => {
    const store = createMapViewStore(INITIAL_STATE);
    const listener = vi.fn();
    store.subscribe(listener);

    store.setCamera({ center: [-115.1728, 36.1147], zoom: 11 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('updates representation and filters without changing the camera', () => {
    const store = createMapViewStore(INITIAL_STATE);
    const camera = store.getSnapshot().camera;

    store.setRepresentationId('infrastructure');
    store.setFilter('landmarks', false);
    store.setFilter('modes', ['rail']);

    expect(store.getSnapshot()).toEqual({
      ...INITIAL_STATE,
      representationId: 'infrastructure',
      filters: { landmarks: false, modes: ['rail'] },
    });
    expect(store.getSnapshot().camera).toBe(camera);
  });

  it('replaces the complete presentation state and drops stale filters', () => {
    const store = createMapViewStore(INITIAL_STATE);

    store.replace({
      schemaVersion: 1,
      camera: { center: [-122.3321, 47.6062], zoom: 10 },
      representationId: 'diagram',
      filters: { frequency: 'frequent' },
    });

    expect(store.getSnapshot()).toEqual({
      schemaVersion: 1,
      camera: { center: [-122.3321, 47.6062], zoom: 10 },
      representationId: 'diagram',
      filters: { frequency: 'frequent' },
    });
  });

  it('stops publishing after a subscriber unsubscribes', () => {
    const store = createMapViewStore(INITIAL_STATE);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.setRepresentationId('diagram');

    expect(listener).not.toHaveBeenCalled();
  });
});
