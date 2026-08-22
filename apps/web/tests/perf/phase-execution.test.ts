import { describe, expect, it } from 'vitest';
import {
  executePerformancePhases,
  requestedPerformancePhases,
} from '../../scripts/perf/phase-execution';

describe('performance phase orchestration', () => {
  it('keeps a selected RTC scenario out of the public phase', () => {
    expect(
      requestedPerformancePhases({
        scenarioId: 'rtc',
        firstSession: false,
        onboarding: false,
      }),
    ).toEqual(['instrumented']);
  });

  it('retains the combined matrix for a normal full audit', () => {
    expect(
      requestedPerformancePhases({
        firstSession: false,
        onboarding: false,
      }),
    ).toEqual(['instrumented', 'first-session']);
  });

  it('runs each explicit standalone phase without the instrumented matrix', () => {
    expect(requestedPerformancePhases({ firstSession: true, onboarding: false })).toEqual([
      'first-session',
    ]);
    expect(requestedPerformancePhases({ firstSession: false, onboarding: true })).toEqual([
      'onboarding',
    ]);
  });

  it('preserves completed phases and marks later work unavailable after a failure', async () => {
    const calls: string[] = [];
    const result = await executePerformancePhases(
      ['instrumented', 'first-session', 'onboarding'],
      (phase) => {
        calls.push(phase);
        return phase === 'first-session'
          ? Promise.reject(new Error('share did not settle'))
          : Promise.resolve();
      },
    );

    expect(calls).toEqual(['instrumented', 'first-session']);
    expect(result.phases).toEqual([
      { phase: 'instrumented', status: 'passed' },
      { phase: 'first-session', status: 'failed', reason: 'share did not settle' },
      {
        phase: 'onboarding',
        status: 'unavailable',
        reason: 'Not run because the first-session phase failed.',
      },
    ]);
    expect(result.error).toBeInstanceOf(Error);
  });
});
