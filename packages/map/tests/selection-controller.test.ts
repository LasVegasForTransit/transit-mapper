import { describe, expect, it, vi } from 'vitest';
import { createSelectionController } from '../src/index';

describe('createSelectionController', () => {
  it('owns an immutable copy of the selected feature', () => {
    const input = { source: 'transit', kind: 'stop', id: 'stop-1' };
    const selection = createSelectionController(input);

    input.id = 'changed';

    expect(selection.getSnapshot()).toEqual({
      source: 'transit',
      kind: 'stop',
      id: 'stop-1',
    });
    expect(Object.isFrozen(selection.getSnapshot())).toBe(true);
  });

  it('publishes an immutable selection and supports clearing it', () => {
    const selection = createSelectionController();
    const listener = vi.fn();
    selection.subscribe(listener);

    selection.select({ source: 'transit', kind: 'station', id: 'station-1' });
    selection.select(undefined);

    expect(listener).toHaveBeenNthCalledWith(1, {
      source: 'transit',
      kind: 'station',
      id: 'station-1',
    });
    expect(Object.isFrozen(listener.mock.calls[0]?.[0])).toBe(true);
    expect(listener).toHaveBeenNthCalledWith(2, undefined);
    expect(selection.getSnapshot()).toBeUndefined();
  });

  it('does not publish the same feature reference twice', () => {
    const selection = createSelectionController({
      source: 'transit',
      kind: 'line',
      id: 'line-1',
    });
    const listener = vi.fn();
    selection.subscribe(listener);

    selection.select({ source: 'transit', kind: 'line', id: 'line-1' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops publishing after a subscriber unsubscribes', () => {
    const selection = createSelectionController();
    const listener = vi.fn();
    const unsubscribe = selection.subscribe(listener);

    unsubscribe();
    selection.select({ source: 'transit', kind: 'stop', id: 'stop-1' });

    expect(listener).not.toHaveBeenCalled();
  });
});
