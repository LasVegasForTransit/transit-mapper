import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  armVisibilityAwareTimeout,
  type VisibilityAwareTimeout,
  type VisibilitySource,
} from '../../src/map/export/visibilityAwareTimeout';

class FakeVisibility implements VisibilitySource {
  hidden = false;
  private listeners = new Set<() => void>();
  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.delete(listener);
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of this.listeners) listener();
  }
}

// MapLibre's tile loading and painting run entirely on requestAnimationFrame,
// which browsers fully suspend while a document is hidden, so the offscreen
// export map makes zero progress until it's visible again. A flat wall-clock
// timeout used to fire for that dead time even though the export would have
// completed fine — this is the regression the bug fixed.
//
// Fake timers make the countdown deterministic: armVisibilityAwareTimeout's own
// setTimeout advances exactly as far as vi.advanceTimersByTime says, so a test
// can assert on wall-clock behavior without waiting on the real clock.
describe("PNG export's render timeout pauses while the tab is hidden", () => {
  // Fresh fake timers per test (not once for the whole suite): a timer armed
  // by one test but never advanced to completion would otherwise sit in a
  // shared virtual-clock queue and fire mid-way through a LATER test's own
  // advances, corrupting that test's `fired`/`resumes` closures.
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a visible tab still times out after the full window', () => {
    const visibility = new FakeVisibility();
    let fired = false;
    armVisibilityAwareTimeout(50, () => (fired = true), visibility);
    vi.advanceTimersByTime(300);
    expect(fired).toBe(true);
  });

  it('a tab that starts hidden never times out on its own', () => {
    const visibility = new FakeVisibility();
    visibility.hidden = true;
    let fired = false;
    armVisibilityAwareTimeout(50, () => (fired = true), visibility);
    vi.advanceTimersByTime(300);
    expect(fired).toBe(false);
  });

  describe('going hidden pauses the countdown, and becoming visible starts a fresh one', () => {
    let visibility: FakeVisibility;
    let fired: boolean;
    let resumes: number;

    beforeEach(() => {
      visibility = new FakeVisibility();
      fired = false;
      resumes = 0;
      armVisibilityAwareTimeout(
        250,
        () => (fired = true),
        visibility,
        () => resumes++,
      );
      vi.advanceTimersByTime(50);
      visibility.setHidden(true); // pause with the window mostly unelapsed
    });

    it('going hidden pauses the countdown instead of firing it', () => {
      vi.advanceTimersByTime(300); // well past the original 250ms budget
      expect(fired).toBe(false);
    });

    describe('becoming visible again', () => {
      beforeEach(() => {
        vi.advanceTimersByTime(300); // well past the original 250ms budget, still hidden
        visibility.setHidden(false); // resume: a fresh 250ms window
      });

      it('becoming visible again calls onResume', () => {
        expect(resumes).toBe(1);
      });

      it('the fresh window has not fired yet', () => {
        vi.advanceTimersByTime(50);
        expect(fired).toBe(false);
      });

      it('the fresh window fires once it fully elapses', () => {
        vi.advanceTimersByTime(300);
        expect(fired).toBe(true);
      });
    });
  });

  describe('cancel stops the timeout for good', () => {
    let visibility: FakeVisibility;
    let fired: boolean;
    let timeout: VisibilityAwareTimeout;

    beforeEach(() => {
      visibility = new FakeVisibility();
      fired = false;
      timeout = armVisibilityAwareTimeout(50, () => (fired = true), visibility);
      timeout.cancel();
    });

    it('cancel stops the timeout for good', () => {
      vi.advanceTimersByTime(300);
      expect(fired).toBe(false);
    });

    it('cancel also detaches the visibility listener', () => {
      vi.advanceTimersByTime(300);
      visibility.setHidden(true);
      visibility.setHidden(false);
      vi.advanceTimersByTime(300);
      expect(fired).toBe(false);
    });
  });
});
