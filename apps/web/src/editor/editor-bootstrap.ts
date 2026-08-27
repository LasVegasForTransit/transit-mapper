import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { listLibrary, loadSystemEntry, migrateLegacySingleSlot } from '../storage/browserLibrary';
import { resolveLibraryBootstrap, type BootstrapLibrary } from '../storage/bootstrapLibrary';
import { getActiveId } from '../storage/localStore';

export interface EditorBootstrapSources {
  getActiveId(): string | null;
  library: BootstrapLibrary;
  createSystem(): TransitSystem;
}

export type EditorBootstrapOutcome =
  | {
      kind: 'ready';
      system: TransitSystem;
      source: 'local-library';
      isBrandNew: boolean;
      encounteredCorruption: boolean;
    }
  | { kind: 'storage-unavailable' }
  | { kind: 'aborted' };

const browserSources: EditorBootstrapSources = {
  getActiveId,
  library: {
    load: loadSystemEntry,
    list: listLibrary,
    migrateLegacySingleSlot,
  },
  createSystem: createEmptySystem,
};

function signalWasAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Resolve one accepted route into the document the editor session may install.
 * The caller owns all UI and storage writes, so failure and disposal outcomes
 * cannot install or autosave a replacement document. */
export async function resolveEditorBootstrap(
  signal: AbortSignal,
  sources: EditorBootstrapSources = browserSources,
): Promise<EditorBootstrapOutcome> {
  if (signal.aborted) return { kind: 'aborted' };

  const result = await resolveLibraryBootstrap({
    activeId: sources.getActiveId(),
    library: sources.library,
    createSystem: () => sources.createSystem(),
  });
  if (signalWasAborted(signal)) return { kind: 'aborted' };
  if (result.status === 'unavailable') return { kind: 'storage-unavailable' };
  return {
    kind: 'ready',
    system: result.system,
    source: 'local-library',
    isBrandNew: result.isBrandNew,
    encounteredCorruption: result.encounteredCorruption,
  };
}
