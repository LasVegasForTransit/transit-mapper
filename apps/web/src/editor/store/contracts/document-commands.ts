import type { TransitSystem, Viewport } from '@transitmapper/core/model/system';

export interface SetSystemOptions {
  readOnly?: boolean;
}

export interface DocumentCommands {
  readonly setSystem: (system: TransitSystem, options?: SetSystemOptions) => void;
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
