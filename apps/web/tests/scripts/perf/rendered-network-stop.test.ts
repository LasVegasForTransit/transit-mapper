import { describe, expect, it } from 'vitest';
import { selectRenderedNetworkStopId } from '../../../scripts/perf/rendered-network-stop';

describe('rendered Network Stop selection', () => {
  it('chooses the first served Stop that the active source bank has painted', () => {
    expect(
      selectRenderedNetworkStopId([
        { id: 'served-but-culled', layerIds: [] },
        { id: 'visible-stop', layerIds: ['tm-stations--bank-b'] },
        { id: 'visible-later', layerIds: ['tm-stations--bank-a'] },
      ]),
    ).toBe('visible-stop');
  });

  it('does not treat a non-station hit as an editable Network Stop', () => {
    expect(
      selectRenderedNetworkStopId([{ id: 'hit-only', layerIds: ['tm-hit-features--bank-a'] }]),
    ).toBeNull();
  });
});
