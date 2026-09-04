import { describe, expect, it } from 'vitest';
import {
  captureOnboardingJourney,
  onboardingJourneyFunctionalViolations,
  onboardingJourneyViolations,
  type OnboardingJourneyDriver,
} from '../../scripts/perf/onboarding-journey';

describe('the onboarding performance journey', () => {
  it('advances through every slide with trusted clicks and records browser observations', async () => {
    const calls: string[] = [];
    let slide = 1;
    const driver: OnboardingJourneyDriver = {
      open: () => {
        calls.push('open');
        return Promise.resolve();
      },
      settle: () => {
        calls.push(`settle:${slide}`);
        return Promise.resolve();
      },
      slideCount: () => Promise.resolve(5),
      beginSlideMeasurement: () => {
        calls.push(`begin:${slide}`);
        return Promise.resolve();
      },
      clickNext: () => {
        calls.push(`click:${slide}`);
        slide += 1;
        return Promise.resolve();
      },
      waitForSlide: (expected) => {
        calls.push(`wait:${expected}`);
        return Promise.resolve();
      },
      finishSlideMeasurement: () => Promise.resolve([12, 24]),
      observations: () =>
        Promise.resolve({
          previewCanvasCount: 1,
          uniquePreviewCanvasCount: 1,
          webGlContextCount: 1,
          remoteStyleRequests: [],
        }),
    };

    const sample = await captureOnboardingJourney(driver);

    expect(calls.filter((call) => call.startsWith('click:'))).toHaveLength(4);
    expect(calls.at(-1)).toBe('wait:5');
    expect(sample).toMatchObject({
      slideCount: 5,
      trustedClickCount: 4,
      previewCanvasCount: 1,
      webGlContextCount: 1,
      mapReconstructionCount: 0,
      maximumSlideLongTaskMs: 24,
    });
    expect(onboardingJourneyViolations(sample, { enforceNumericBudgets: true })).toEqual([]);
  });

  it('waits for a quiet main thread before every slide click, not only the first', async () => {
    const calls: string[] = [];
    let slide = 1;
    const record = (name: string) => (): Promise<void> => {
      calls.push(`${name}:${slide}`);
      if (name === 'click') slide += 1;
      return Promise.resolve();
    };
    const driver: OnboardingJourneyDriver = {
      open: () => Promise.resolve(),
      settle: record('settle'),
      slideCount: () => Promise.resolve(3),
      beginSlideMeasurement: record('begin'),
      clickNext: record('click'),
      waitForSlide: () => Promise.resolve(),
      finishSlideMeasurement: () => Promise.resolve([]),
      observations: () =>
        Promise.resolve({
          previewCanvasCount: 1,
          uniquePreviewCanvasCount: 1,
          webGlContextCount: 1,
          remoteStyleRequests: [],
        }),
    };

    await captureOnboardingJourney(driver);

    expect(calls).toEqual(['settle:1', 'begin:1', 'click:1', 'settle:2', 'begin:2', 'click:2']);
  });

  it('keeps responsiveness thresholds out of a functional smoke', () => {
    const sample = {
      slideCount: 5,
      trustedClickCount: 4,
      previewCanvasCount: 1,
      webGlContextCount: 2,
      mapReconstructionCount: 1,
      remoteStyleRequests: ['https://tiles.openfreemap.org/styles/positron'],
      slideLongTasksMs: [51],
      maximumSlideLongTaskMs: 51,
    };

    expect(onboardingJourneyFunctionalViolations(sample)).toEqual([
      'Onboarding created 2 WebGL contexts; expected exactly 1.',
      'Onboarding reconstructed its preview map 1 time; expected 0.',
      'Onboarding requested a remote map style: https://tiles.openfreemap.org/styles/positron.',
    ]);
    expect(onboardingJourneyViolations(sample, { enforceNumericBudgets: false })).toEqual([
      'Onboarding created 2 WebGL contexts; expected exactly 1.',
      'Onboarding reconstructed its preview map 1 time; expected 0.',
      'Onboarding requested a remote map style: https://tiles.openfreemap.org/styles/positron.',
    ]);
    expect(onboardingJourneyViolations(sample, { enforceNumericBudgets: true })).toEqual([
      'Onboarding created 2 WebGL contexts; expected exactly 1.',
      'Onboarding reconstructed its preview map 1 time; expected 0.',
      'Onboarding requested a remote map style: https://tiles.openfreemap.org/styles/positron.',
      'Onboarding produced a 51 ms slide-change task; the limit is 50 ms.',
    ]);
  });
});
