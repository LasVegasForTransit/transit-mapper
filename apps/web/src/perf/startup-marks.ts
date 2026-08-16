export const BOOTSTRAP_START_MARK = 'tm:bootstrap-start';
export const SHELL_MOUNTED_MARK = 'tm:shell-mounted';
export const STORAGE_READ_START_MARK = 'tm:storage-read-start';
export const STORAGE_READ_END_MARK = 'tm:storage-read-end';
export const DESERIALIZE_START_MARK = 'tm:deserialize-start';
export const DESERIALIZE_END_MARK = 'tm:deserialize-end';
export const SYSTEM_COMMITTED_MARK = 'tm:system-committed';
export const MAP_STYLE_READY_MARK = 'tm:map-style-ready';
export const FIRST_SYSTEM_PAINT_MARK = 'tm:first-system-paint';
export const INTERACTIVE_MARK = 'tm:interactive';
export const SERVICE_WORKER_READY_MARK = 'tm:service-worker-ready';

export const FIRST_SESSION_MARK_NAMES = [
  BOOTSTRAP_START_MARK,
  SHELL_MOUNTED_MARK,
  STORAGE_READ_START_MARK,
  STORAGE_READ_END_MARK,
  DESERIALIZE_START_MARK,
  DESERIALIZE_END_MARK,
  SYSTEM_COMMITTED_MARK,
  MAP_STYLE_READY_MARK,
  FIRST_SYSTEM_PAINT_MARK,
  INTERACTIVE_MARK,
  SERVICE_WORKER_READY_MARK,
] as const;

export type FirstSessionMarkName = (typeof FIRST_SESSION_MARK_NAMES)[number];

/** Publish one low-cost User Timing milestone without putting startup at the
 * mercy of an optional diagnostics API. The timeline is the source of truth
 * so independently loaded entry points still converge on a single mark. */
export function markOnce(name: FirstSessionMarkName): void {
  try {
    if (globalThis.performance.getEntriesByName(name, 'mark').length === 0) {
      globalThis.performance.mark(name);
    }
  } catch {
    // User Timing is observability only. A restricted or partial
    // implementation must never become a startup failure.
  }
}
