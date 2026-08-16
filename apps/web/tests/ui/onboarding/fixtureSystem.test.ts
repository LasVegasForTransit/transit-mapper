import { describe, expect, it } from 'vitest';
import { validateSystem } from '@transitmapper/core/model/validate';
import {
  ONBOARDING_FIXTURE_SYSTEM,
  ONBOARDING_PATTERN_STATS,
} from '../../../src/ui/onboarding/fixtureSystem';

// The one system every onboarding slide's live preview renders. A bad
// fixture (a dangling leg, an orphaned station) would only ever surface as a
// silent blank preview in the dialog — nothing else exercises this data.
describe('onboarding fixture (ui/onboarding/fixtureSystem.ts)', () => {
  it('the onboarding fixture is a real, valid system', () => {
    expect(validateSystem(ONBOARDING_FIXTURE_SYSTEM).length).toBe(0);
  });
  it("the fixture's animated pattern actually measures to a real run", () => {
    expect(ONBOARDING_PATTERN_STATS.plan).not.toBeNull();
    expect(ONBOARDING_PATTERN_STATS.meters).toBeGreaterThan(0);
  });
  it('the onboarding fixture presents a small network rather than a single line', () => {
    expect(ONBOARDING_FIXTURE_SYSTEM.services.length).toBeGreaterThanOrEqual(2);
    expect(ONBOARDING_FIXTURE_SYSTEM.stops.length).toBeGreaterThanOrEqual(4);
  });
  it('the onboarding fixture includes both streets and rail', () => {
    expect(ONBOARDING_FIXTURE_SYSTEM.ways.some((way) => way.typeId === 'road')).toBe(true);
    expect(ONBOARDING_FIXTURE_SYSTEM.ways.some((way) => way.typeId === 'lightRail')).toBe(true);
  });
});
