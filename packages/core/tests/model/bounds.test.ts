import { describe, expect, it } from 'vitest';
import { systemBounds } from '../../src/model/geo/bounds';
import { aStation, aStop, aSystem } from '../support/fixtures.test';

describe('system bounds', () => {
  it('includes Stops and Station footprints and platforms', () => {
    const system = aSystem({
      stops: [aStop('stop', [-115.2, 36.1])],
      stations: [
        aStation('station', [-115.15, 36.15], {
          footprint: [
            [-115.25, 36.05],
            [-115.1, 36.2],
          ],
          platforms: [{ id: 'platform', points: [[-115.05, 36.25]] }],
        }),
      ],
    });

    expect(systemBounds(system)).toEqual([
      [-115.25, 36.05],
      [-115.05, 36.25],
    ]);
  });

  it('returns null when no spatial record exists', () => {
    expect(systemBounds(aSystem())).toBeNull();
  });
});
