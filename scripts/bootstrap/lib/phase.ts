import type { BootstrapIo } from './io.js';

export interface PhaseResult {
  success: boolean;
}

/** What every phase is handed: the run's mode and the seam to the world. */
export interface PhaseContext {
  /** Report problems, create and write nothing. */
  doctor: boolean;
  /** Replace the CLOUDFLARE_API_TOKEN secret even where it is already set. */
  rotateToken: boolean;
  /** Overwrite a CLOUDFLARE_ACCOUNT_ID variable that names another account. */
  replaceAccountId: boolean;
  io: BootstrapIo;
}
