import { describe, expect, it } from 'vitest';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import { planViewRenderUpdate } from '../../src/map/render-visibility';

function view(
  viewMode: ViewOptions['viewMode'],
  visibleModes: Set<string>,
  visibleWayTypes: Set<string>,
): ViewOptions {
  return { viewMode, visibleModes, visibleWayTypes };
}

describe('view render update plan', () => {
  it('changes mode and way-type filters without reprojecting geometry', () => {
    const before = view('network', new Set(['bus', 'rail']), new Set(['road', 'rail']));
    const after = view('network', new Set(['bus']), new Set(['road']));

    expect(planViewRenderUpdate(before, after)).toEqual({
      reproject: false,
      updateFilters: true,
      notifyVehicles: true,
    });
  });

  it('reprojects when the semantic view changes', () => {
    const modes = new Set(['bus']);
    const wayTypes = new Set(['road']);

    expect(
      planViewRenderUpdate(
        view('network', modes, wayTypes),
        view('infrastructure', modes, wayTypes),
      ),
    ).toEqual({ reproject: true, updateFilters: true, notifyVehicles: true });
  });

  it('does no renderer work when all presentation identities are retained', () => {
    const modes = new Set(['bus']);
    const wayTypes = new Set(['road']);
    const current = view('network', modes, wayTypes);

    expect(planViewRenderUpdate(current, current)).toEqual({
      reproject: false,
      updateFilters: false,
      notifyVehicles: false,
    });
  });
});
