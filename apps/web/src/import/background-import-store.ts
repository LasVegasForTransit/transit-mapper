import type { TransitSystem } from '@transitmapper/core/model/system';

interface BackgroundImportSnapshot {
  system: TransitSystem;
  readOnly: boolean;
  documentStatus: 'loading' | 'ready';
}

/** Narrow imperative port for long-running imports that must watch snapshots. */
export interface BackgroundImportStore {
  readonly getState: () => BackgroundImportSnapshot;
  readonly subscribe: (
    listener: (state: BackgroundImportSnapshot, previous: BackgroundImportSnapshot) => void,
  ) => () => void;
}

/** Explains a terminal background-import refusal; null means a stale snapshot may retry. */
export function backgroundImportBlockMessage(
  store: BackgroundImportStore,
  targetSystemId: string,
): string | null {
  const state = store.getState();
  if (state.system.id !== targetSystemId) {
    return 'RTC import stopped because a different system was opened.';
  }
  if (state.readOnly) return 'RTC import stopped because this system is read-only.';
  if (state.documentStatus === 'loading') {
    return 'RTC import stopped because the system is still loading.';
  }
  return null;
}
