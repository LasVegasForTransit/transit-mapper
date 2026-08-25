import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { RouteIntent } from '../app/route-intent';
import { fetchShare } from '../share/api';
import { listLibrary, loadSystemEntry, migrateLegacySingleSlot } from '../storage/browserLibrary';
import { resolveLibraryBootstrap, type BootstrapLibrary } from '../storage/bootstrapLibrary';
import { getActiveId } from '../storage/localStore';

export interface EditorBootstrapSources {
  fetchSharedSystem(id: string, options: { signal: AbortSignal }): Promise<TransitSystem>;
  getActiveId(): string | null;
  library: BootstrapLibrary;
  createSystem(): TransitSystem;
}

export type EditorBootstrapOutcome =
  | {
      kind: 'ready';
      system: TransitSystem;
      readOnly: true;
      source: 'shared-system';
    }
  | {
      kind: 'ready';
      system: TransitSystem;
      readOnly: false;
      source: 'local-library';
      isBrandNew: boolean;
      encounteredCorruption: boolean;
    }
  | { kind: 'share-failed' }
  | { kind: 'storage-unavailable' }
  | { kind: 'aborted' };

const browserSources: EditorBootstrapSources = {
  fetchSharedSystem: fetchShare,
  getActiveId,
  library: {
    load: loadSystemEntry,
    list: listLibrary,
    migrateLegacySingleSlot,
  },
  createSystem: createEmptySystem,
};

function wasAborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

function signalWasAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Resolve one accepted route into the document the editor session may install.
 * The caller owns all UI and storage writes, so failure and disposal outcomes
 * cannot install or autosave a replacement document. */
export async function resolveEditorBootstrap(
  routeIntent: RouteIntent,
  signal: AbortSignal,
  sources: EditorBootstrapSources = browserSources,
): Promise<EditorBootstrapOutcome> {
  if (signal.aborted) return { kind: 'aborted' };

  if (routeIntent.kind === 'shared-system') {
    try {
      const system = await sources.fetchSharedSystem(routeIntent.shareId, { signal });
      return signalWasAborted(signal)
        ? { kind: 'aborted' }
        : { kind: 'ready', system, readOnly: true, source: 'shared-system' };
    } catch (error: unknown) {
      return wasAborted(error, signal) ? { kind: 'aborted' } : { kind: 'share-failed' };
    }
  }

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
    readOnly: false,
    source: 'local-library',
    isBrandNew: result.isBrandNew,
    encounteredCorruption: result.encounteredCorruption,
  };
}
