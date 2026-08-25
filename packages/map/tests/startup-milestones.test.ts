import { describe, expect, it, vi } from 'vitest';
import { createMapStartupMilestones } from '../src/index';

describe('createMapStartupMilestones', () => {
  it('publishes content before interaction when interaction is reported first', () => {
    const onContentCommitted = vi.fn();
    const onInteractive = vi.fn();
    const milestones = createMapStartupMilestones({ onContentCommitted, onInteractive });

    milestones.interactive();

    expect(onContentCommitted.mock.invocationCallOrder[0]).toBeLessThan(
      onInteractive.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(milestones.getSnapshot()).toEqual({
      contentCommitted: true,
      interactive: true,
    });
  });

  it('publishes each milestone once', () => {
    const onContentCommitted = vi.fn();
    const onInteractive = vi.fn();
    const milestones = createMapStartupMilestones({ onContentCommitted, onInteractive });

    milestones.contentCommitted();
    milestones.contentCommitted();
    milestones.interactive();
    milestones.interactive();

    expect(onContentCommitted).toHaveBeenCalledOnce();
    expect(onInteractive).toHaveBeenCalledOnce();
  });

  it('lets observers subscribe to ordered immutable transitions', () => {
    const milestones = createMapStartupMilestones();
    const snapshots: unknown[] = [];
    milestones.subscribe((snapshot) => snapshots.push(snapshot));

    milestones.contentCommitted();
    milestones.interactive();

    expect(snapshots).toEqual([
      { contentCommitted: true, interactive: false },
      { contentCommitted: true, interactive: true },
    ]);
    expect(snapshots.every(Object.isFrozen)).toBe(true);
  });
});
