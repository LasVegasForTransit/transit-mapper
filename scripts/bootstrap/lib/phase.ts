import type { BootstrapIo } from './io.js';

export interface PhaseResult {
  success: boolean;
}

/** What every phase is handed: the run's mode and the seam to the world. */
export interface PhaseContext {
  /** Report problems, create and write nothing. */
  doctor: boolean;
  io: BootstrapIo;
}
