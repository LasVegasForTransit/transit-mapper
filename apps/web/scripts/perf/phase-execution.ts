import type { PerfAuditPhase, PerfAuditPhaseResult } from '../../src/perf/types';

interface RequestedPerformancePhaseOptions {
  scenarioId?: string;
  firstSession: boolean;
  onboarding: boolean;
}

export function requestedPerformancePhases(
  options: RequestedPerformancePhaseOptions,
): PerfAuditPhase[] {
  if (options.scenarioId) {
    return [
      'instrumented',
      ...(options.firstSession ? (['first-session'] as const) : []),
      ...(options.onboarding ? (['onboarding'] as const) : []),
    ];
  }
  if (options.firstSession || options.onboarding) {
    return [
      ...(options.firstSession ? (['first-session'] as const) : []),
      ...(options.onboarding ? (['onboarding'] as const) : []),
    ];
  }
  return ['instrumented', 'first-session'];
}

export interface PerfPhaseExecution {
  phases: PerfAuditPhaseResult[];
  error?: unknown;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function executePerformancePhases(
  requested: readonly PerfAuditPhase[],
  run: (phase: PerfAuditPhase) => Promise<void>,
): Promise<PerfPhaseExecution> {
  const phases: PerfAuditPhaseResult[] = [];
  for (const [index, phase] of requested.entries()) {
    try {
      await run(phase);
      phases.push({ phase, status: 'passed' });
    } catch (error) {
      const reason = errorMessage(error);
      phases.push({ phase, status: 'failed', reason });
      for (const unavailable of requested.slice(index + 1)) {
        phases.push({
          phase: unavailable,
          status: 'unavailable',
          reason: `Not run because the ${phase} phase failed.`,
        });
      }
      return { phases, error };
    }
  }
  return { phases };
}
