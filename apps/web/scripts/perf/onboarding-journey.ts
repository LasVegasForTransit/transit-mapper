import type { PerfOnboardingSample } from '../../src/perf/types';

export interface OnboardingJourneyObservations {
  previewCanvasCount: number;
  uniquePreviewCanvasCount: number;
  webGlContextCount: number;
  remoteStyleRequests: string[];
}

export interface OnboardingJourneyDriver {
  open: () => Promise<void>;
  slideCount: () => Promise<number>;
  beginSlideMeasurement: () => Promise<void>;
  clickNext: () => Promise<void>;
  waitForSlide: (slide: number) => Promise<void>;
  finishSlideMeasurement: () => Promise<number[]>;
  observations: () => Promise<OnboardingJourneyObservations>;
}

export interface OnboardingJourneyViolationOptions {
  enforceNumericBudgets: boolean;
}

export async function captureOnboardingJourney(
  driver: OnboardingJourneyDriver,
): Promise<PerfOnboardingSample> {
  await driver.open();
  const slideCount = await driver.slideCount();
  if (!Number.isInteger(slideCount) || slideCount < 1) {
    throw new Error(`Onboarding reported an invalid slide count: ${slideCount}.`);
  }
  const slideLongTasksMs: number[] = [];
  for (let slide = 2; slide <= slideCount; slide += 1) {
    await driver.beginSlideMeasurement();
    await driver.clickNext();
    await driver.waitForSlide(slide);
    slideLongTasksMs.push(...(await driver.finishSlideMeasurement()));
  }
  const observations = await driver.observations();
  return {
    slideCount,
    trustedClickCount: slideCount - 1,
    previewCanvasCount: observations.previewCanvasCount,
    webGlContextCount: observations.webGlContextCount,
    mapReconstructionCount: Math.max(0, observations.uniquePreviewCanvasCount - 1),
    remoteStyleRequests: observations.remoteStyleRequests,
    slideLongTasksMs,
    maximumSlideLongTaskMs: Math.max(0, ...slideLongTasksMs),
  };
}

export function onboardingJourneyFunctionalViolations(sample: PerfOnboardingSample): string[] {
  const violations: string[] = [];
  if (sample.previewCanvasCount !== 1) {
    violations.push(
      `Onboarding rendered ${sample.previewCanvasCount} preview canvases; expected exactly 1.`,
    );
  }
  if (sample.webGlContextCount !== 1) {
    violations.push(
      `Onboarding created ${sample.webGlContextCount} WebGL contexts; expected exactly 1.`,
    );
  }
  if (sample.mapReconstructionCount !== 0) {
    const suffix = sample.mapReconstructionCount === 1 ? 'time' : 'times';
    violations.push(
      `Onboarding reconstructed its preview map ${sample.mapReconstructionCount} ${suffix}; expected 0.`,
    );
  }
  if (sample.remoteStyleRequests.length > 0) {
    violations.push(
      `Onboarding requested a remote map style: ${sample.remoteStyleRequests.join(', ')}.`,
    );
  }
  return violations;
}

export function onboardingJourneyViolations(
  sample: PerfOnboardingSample,
  options: OnboardingJourneyViolationOptions,
): string[] {
  const violations = onboardingJourneyFunctionalViolations(sample);
  if (options.enforceNumericBudgets && sample.maximumSlideLongTaskMs > 50) {
    violations.push(
      `Onboarding produced a ${sample.maximumSlideLongTaskMs} ms slide-change task; the limit is 50 ms.`,
    );
  }
  return violations;
}
