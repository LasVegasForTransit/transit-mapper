import { describe, expect, it } from 'vitest';
import { passengerPlaceTool } from '../../src/ui/Toolbar';

describe('passenger-place tool language', () => {
  it('places Stops in Network and draws Stations in Infrastructure', () => {
    expect(passengerPlaceTool('network')).toMatchObject({ label: 'Stop', icon: 'stop' });
    expect(passengerPlaceTool('infrastructure')).toMatchObject({
      label: 'Station',
      icon: 'boundary',
    });
  });
});
