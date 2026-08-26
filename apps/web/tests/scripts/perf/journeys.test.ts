import { describe, expect, it } from 'vitest';
import { PERF_SCENARIOS } from '../../../src/perf/scenarios';
import {
  scenarioCameraDragProof,
  scenarioIdentitySelector,
  scenarioRequiresPaintedFrameSamples,
  scenarioRequiresEditorProjectionCounts,
} from '../../../scripts/perf/journeys';

describe('performance journey readiness', () => {
  it('verifies a viewer title through the scenario-owned ready element', () => {
    const scenario = {
      ...PERF_SCENARIOS.viewer,
      readySelector: '.contract-owned-viewer-title',
    };

    expect(scenarioIdentitySelector(scenario)).toBe('.contract-owned-viewer-title');
  });

  it('requires editor projection diagnostics only for editor journeys', () => {
    expect(scenarioRequiresEditorProjectionCounts(PERF_SCENARIOS.rtc)).toBe(true);
    expect(scenarioRequiresEditorProjectionCounts(PERF_SCENARIOS.viewer)).toBe(false);
    expect(scenarioRequiresEditorProjectionCounts(PERF_SCENARIOS.embed)).toBe(false);
  });

  it('requires editor paint samples only for editor journeys', () => {
    expect(scenarioRequiresPaintedFrameSamples(PERF_SCENARIOS.rtc)).toBe(true);
    expect(scenarioRequiresPaintedFrameSamples(PERF_SCENARIOS.viewer)).toBe(false);
    expect(scenarioRequiresPaintedFrameSamples(PERF_SCENARIOS.embed)).toBe(false);
  });

  it('proves camera movement through each surface-owned state boundary', () => {
    expect(scenarioCameraDragProof(PERF_SCENARIOS.rtc)).toBe('editor-projection');
    expect(scenarioCameraDragProof(PERF_SCENARIOS.viewer)).toBe('viewer-url');
    expect(scenarioCameraDragProof(PERF_SCENARIOS.embed)).toBe('embed-camera');
  });
});
