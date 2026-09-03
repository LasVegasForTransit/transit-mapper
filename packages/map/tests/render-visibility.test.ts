import { describe, expect, it } from 'vitest';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import { planViewRenderUpdate } from '../src/render-visibility';

function view(
  viewMode: ViewOptions['viewMode'],
  visibleModes: Set<string>,
  visibleWayTypes: Set<string>,
): ViewOptions {
  return { viewMode, visibleModes, visibleWayTypes };
}

describe('renderer visibility updates', () => {
  it('reprojects passenger Lines when the visible mode set changes', () => {
    const before = view('network', new Set(['bus', 'lightRail']), new Set(['road']));
    const after = { ...before, visibleModes: new Set(['bus']) };

    expect(planViewRenderUpdate(before, after)).toMatchObject({
      reproject: true,
      updateFilters: true,
      notifyVehicles: true,
    });
  });

  it('updates way-type filters without reprojecting geometry', () => {
    const before = view('network', new Set(['bus']), new Set(['road', 'rail']));
    const after = view('network', before.visibleModes, new Set(['road']));

    expect(planViewRenderUpdate(before, after)).toEqual({
      reproject: false,
      updateFilters: true,
      notifyVehicles: false,
    });
  });

  it('reprojects when the representation changes', () => {
    const modes = new Set(['bus']);
    const wayTypes = new Set(['road']);

    expect(
      planViewRenderUpdate(
        view('network', modes, wayTypes),
        view('infrastructure', modes, wayTypes),
      ),
    ).toEqual({ reproject: true, updateFilters: true, notifyVehicles: true });
  });

  it('does no work when all presentation identities are retained', () => {
    const current = view('network', new Set(['bus']), new Set(['road']));

    expect(planViewRenderUpdate(current, current)).toEqual({
      reproject: false,
      updateFilters: false,
      notifyVehicles: false,
    });
  });
});
