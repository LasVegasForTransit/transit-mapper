import { describe, expect, it } from 'vitest';
import { servicesAtStation } from '@transitmapper/core/sim/frequency';
import { generatePerfFixture } from '../../../src/perf/fixtures';
import { networkEditStationId } from '../../../scripts/perf/offline-edit-target';

describe('offline performance edit target', () => {
  it('chooses a station rendered by the Network fixture instead of an unserved midpoint', () => {
    const fixture = generatePerfFixture('small');
    const midpoint = fixture.stations[Math.floor(fixture.stations.length / 2)];
    const targetId = networkEditStationId(fixture);
    const target = fixture.stations.find((station) => station.id === targetId);

    expect(servicesAtStation(fixture.ways, fixture.services, midpoint)).toHaveLength(0);
    expect(targetId).toBe('small-station-0012');
    expect(target).toBeDefined();
    expect(
      target && servicesAtStation(fixture.ways, fixture.services, target).length,
    ).toBeGreaterThan(0);
  });
});
