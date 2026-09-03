import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('PlaceSearchGate', () => {
  it(
    'permits only one aggregate provider reservation per second',
    { timeout: 10_000 },
    async () => {
      const gate = env.PLACE_SEARCH_GATE.getByName('nominatim-policy-test');

      expect(await gate.reserve(1_000)).toBe(0);
      expect(await gate.reserve(1_000)).toBe(1);
    },
  );
});
