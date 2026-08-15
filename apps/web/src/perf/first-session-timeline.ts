import type { FirstSessionMarkName } from './startup-marks';
import {
  BOOTSTRAP_START_MARK,
  DESERIALIZE_END_MARK,
  DESERIALIZE_START_MARK,
  FIRST_SYSTEM_PAINT_MARK,
  INTERACTIVE_MARK,
  MAP_STYLE_READY_MARK,
  SERVICE_WORKER_READY_MARK,
  SHELL_MOUNTED_MARK,
  STORAGE_READ_END_MARK,
  STORAGE_READ_START_MARK,
  SYSTEM_COMMITTED_MARK,
} from './startup-marks';
import type { PerfNetworkPhaseName } from './network-byte-types';
import type { PerfFirstSessionMilestones } from './types';

export const AUTOMATIC_FIRST_SESSION_BOUNDARY_MS = 60_000;

interface CreateFirstSessionTimelineOptions {
  navigationTimeOriginMs: number;
  documentResponseEndMs: number;
  networkIdleMs: number | null;
  marks: Partial<Record<FirstSessionMarkName, number>>;
}

export interface PerfFirstSessionTimeline {
  navigationTimeOriginMs: number;
  milestones: PerfFirstSessionMilestones;
  bytePhases: Partial<Record<PerfNetworkPhaseName, number>>;
}

function mark(
  marks: Partial<Record<FirstSessionMarkName, number>>,
  name: FirstSessionMarkName,
): number | null {
  return marks[name] ?? null;
}

export function createFirstSessionTimeline(
  options: CreateFirstSessionTimelineOptions,
): PerfFirstSessionTimeline {
  const milestones: PerfFirstSessionMilestones = {
    documentResponseEndMs: options.documentResponseEndMs,
    bootstrapStartMs: mark(options.marks, BOOTSTRAP_START_MARK),
    shellMountedMs: mark(options.marks, SHELL_MOUNTED_MARK),
    storageReadStartMs: mark(options.marks, STORAGE_READ_START_MARK),
    storageReadEndMs: mark(options.marks, STORAGE_READ_END_MARK),
    deserializeStartMs: mark(options.marks, DESERIALIZE_START_MARK),
    deserializeEndMs: mark(options.marks, DESERIALIZE_END_MARK),
    systemCommittedMs: mark(options.marks, SYSTEM_COMMITTED_MARK),
    mapStyleReadyMs: mark(options.marks, MAP_STYLE_READY_MARK),
    firstSystemPaintMs: mark(options.marks, FIRST_SYSTEM_PAINT_MARK),
    interactiveMs: mark(options.marks, INTERACTIVE_MARK),
    networkIdleMs: options.networkIdleMs,
    serviceWorkerReadyMs: mark(options.marks, SERVICE_WORKER_READY_MARK),
  };
  const bytePhases: Partial<Record<PerfNetworkPhaseName, number>> = {
    document: milestones.documentResponseEndMs,
    automaticBoundary: AUTOMATIC_FIRST_SESSION_BOUNDARY_MS,
  };
  if (milestones.shellMountedMs !== null) bytePhases.shell = milestones.shellMountedMs;
  if (milestones.systemCommittedMs !== null) {
    bytePhases.documentReady = milestones.systemCommittedMs;
  }
  if (milestones.firstSystemPaintMs !== null) {
    bytePhases.firstSystemPaint = milestones.firstSystemPaintMs;
  }
  if (milestones.interactiveMs !== null) {
    bytePhases.interactionReady = milestones.interactiveMs;
  }
  if (milestones.networkIdleMs !== null) bytePhases.networkIdle = milestones.networkIdleMs;
  if (milestones.serviceWorkerReadyMs !== null) {
    bytePhases.serviceWorkerReady = milestones.serviceWorkerReadyMs;
  }
  return {
    navigationTimeOriginMs: options.navigationTimeOriginMs,
    milestones,
    bytePhases,
  };
}
