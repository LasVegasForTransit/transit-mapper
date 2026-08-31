import { describe, expect, it } from 'vitest';
import { planViewRenderUpdate } from '../src/render-visibility';

describe('renderer visibility updates', () => {
  it('reprojects passenger Lines when the visible mode set changes', () => {
    const before = {
      viewMode: 'network' as const,
      visibleModes: new Set(['bus', 'lightRail']),
      visibleWayTypes: new Set(['road']),
    };
    const after = { ...before, visibleModes: new Set(['bus']) };

    expect(planViewRenderUpdate(before, after)).toMatchObject({
      reproject: true,
      updateFilters: true,
      notifyVehicles: true,
    });
  });
});
