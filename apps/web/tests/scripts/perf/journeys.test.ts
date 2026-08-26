import { describe, expect, it } from 'vitest';
import { PERF_SCENARIOS } from '../../../src/perf/scenarios';
import { scenarioIdentitySelector } from '../../../scripts/perf/journeys';

describe('performance journey readiness', () => {
  it('verifies a viewer title through the scenario-owned ready element', () => {
    const scenario = {
      ...PERF_SCENARIOS.viewer,
      readySelector: '.contract-owned-viewer-title',
    };

    expect(scenarioIdentitySelector(scenario)).toBe('.contract-owned-viewer-title');
  });
});
