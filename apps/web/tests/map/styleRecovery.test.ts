import { describe, expect, it, vi } from 'vitest';
import { recoverMapStyleState, type MapStyleRecoverySteps } from '../../src/map/styleRecovery';

function recoveryHarness(overlayReady = true) {
  const calls: string[] = [];
  const step = (name: string) =>
    vi.fn(() => {
      calls.push(name);
    });
  const steps: MapStyleRecoverySteps = {
    registerIcons: step('icons'),
    ensureOverlay: vi.fn(() => {
      calls.push('overlay');
      return overlayReady;
    }),
    restoreFeatureData: step('feature data and selection'),
    restoreHover: step('hover'),
    restoreHaloVisibility: step('halos'),
    restoreRouteFocus: step('route focus'),
    restoreLandmarkVisibility: step('landmarks'),
    restoreDiagramVisibility: step('diagram visibility'),
    restoreSimulation: step('simulation'),
    repaint: step('repaint'),
  };
  return { calls, steps };
}

describe('map style recovery', () => {
  it('restores every app-owned state class through one ordered path', () => {
    const { calls, steps } = recoveryHarness();

    expect(recoverMapStyleState(steps)).toBe(true);
    expect(calls).toEqual([
      'icons',
      'overlay',
      'feature data and selection',
      'hover',
      'halos',
      'route focus',
      'landmarks',
      'diagram visibility',
      'simulation',
      'repaint',
    ]);
  });

  it('waits for a usable style before restoring dependent state', () => {
    const { calls, steps } = recoveryHarness(false);

    expect(recoverMapStyleState(steps)).toBe(false);
    expect(calls).toEqual(['icons', 'overlay']);
  });
});
