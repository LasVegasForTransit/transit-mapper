import { describe, expect, it } from 'vitest';
import { servicesAtStop } from '@transitmapper/core/sim/frequency';
import { generatePerfFixture } from '../../../src/perf/fixtures';
import {
  networkEditStopCandidates,
  networkEditStopId,
} from '../../../scripts/perf/offline-edit-target';

describe('offline performance edit target', () => {
  it('chooses a Stop rendered by the Network fixture instead of an unserved midpoint', () => {
    const fixture = generatePerfFixture('small');
    const midpoint = fixture.stops[Math.floor(fixture.stops.length / 2)];
    const targetId = networkEditStopId(fixture);
    const target = fixture.stops.find((stop) => stop.id === targetId);

    expect(servicesAtStop(fixture.ways, fixture.services, midpoint)).toHaveLength(0);
    expect(targetId).toBe('small-stop-0012');
    expect(target).toBeDefined();
    expect(target && servicesAtStop(fixture.ways, fixture.services, target).length).toBeGreaterThan(
      0,
    );
  });

  it('orders every served Stop by distance from the fitted camera', () => {
    const fixture = generatePerfFixture('small');
    const candidates = networkEditStopCandidates(fixture);

    expect(candidates[0]?.id).toBe('small-stop-0012');
    expect(candidates).toHaveLength(8);
    expect(candidates.map((stop) => stop.id)).not.toContain('small-stop-0015');
  });
});
