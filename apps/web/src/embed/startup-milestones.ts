import {
  BOOTSTRAP_START_MARK,
  INTERACTIVE_MARK,
  MAP_STYLE_READY_MARK,
  SHELL_MOUNTED_MARK,
  SYSTEM_COMMITTED_MARK,
  markOnce,
} from '../perf/startup-marks';

export interface EmbedStartupMilestones {
  bootstrapStarted(): void;
  shellMounted(): void;
  mapStyleReady(): void;
  systemCommitted(): void;
  interactive(): void;
}

export function createEmbedStartupMilestones(): EmbedStartupMilestones {
  return {
    bootstrapStarted: () => markOnce(BOOTSTRAP_START_MARK),
    shellMounted: () => markOnce(SHELL_MOUNTED_MARK),
    mapStyleReady: () => markOnce(MAP_STYLE_READY_MARK),
    systemCommitted: () => markOnce(SYSTEM_COMMITTED_MARK),
    interactive: () => markOnce(INTERACTIVE_MARK),
  };
}
