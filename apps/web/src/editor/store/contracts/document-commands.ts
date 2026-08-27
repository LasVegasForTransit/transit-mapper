import type { TransitSystem, Viewport } from '@transitmapper/core/model/system';

export interface DocumentCommands {
  readonly setSystem: (system: TransitSystem) => void;
  readonly newSystem: () => void;
  readonly setName: (name: string) => void;
  readonly setViewport: (viewport: Viewport) => void;
}

export interface HistoryCommands {
  readonly undo: () => void;
  readonly redo: () => void;
  readonly beginHistoryCheckpoint: () => void;
  readonly commitHistoryCheckpoint: () => void;
  readonly cancelHistoryCheckpoint: () => void;
}
