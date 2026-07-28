import type { TransitSystem } from '@transitmapper/core/model/system';
import type { LibraryListResult, LibraryLoadResult } from './libraryStore';

export interface BootstrapLibrary {
  load(id: string): Promise<LibraryLoadResult>;
  list(): Promise<LibraryListResult>;
  migrateLegacySingleSlot(): Promise<TransitSystem | null>;
}

export interface ResolveLibraryBootstrapOptions {
  activeId: string | null;
  library: BootstrapLibrary;
  createSystem: () => TransitSystem;
}

export type LibraryBootstrapResult =
  | {
      status: 'ready';
      system: TransitSystem;
      isBrandNew: boolean;
      encounteredCorruption: boolean;
    }
  | { status: 'unavailable' };

/** Resolve startup without ever interpreting an IndexedDB failure as an
 * empty library. `unavailable` deliberately carries no replacement system:
 * the caller must retain activeId and offer retry rather than point it at a
 * new blank document while the real one is temporarily inaccessible. */
export async function resolveLibraryBootstrap(
  options: ResolveLibraryBootstrapOptions,
): Promise<LibraryBootstrapResult> {
  let encounteredCorruption = false;
  if (options.activeId) {
    const active = await options.library.load(options.activeId);
    if (active.status === 'unavailable') return { status: 'unavailable' };
    if (active.status === 'ok') {
      return {
        status: 'ready',
        system: active.system,
        isBrandNew: false,
        encounteredCorruption: false,
      };
    }
    encounteredCorruption = active.status === 'corrupt';
  }

  const migrated = await options.library.migrateLegacySingleSlot();
  if (migrated) {
    return {
      status: 'ready',
      system: migrated,
      isBrandNew: false,
      encounteredCorruption,
    };
  }

  const listing = await options.library.list();
  if (listing.status === 'unavailable') return listing;
  for (const entry of listing.entries) {
    const loaded = await options.library.load(entry.id);
    if (loaded.status === 'unavailable') return loaded;
    if (loaded.status === 'ok') {
      return {
        status: 'ready',
        system: loaded.system,
        isBrandNew: false,
        encounteredCorruption,
      };
    }
    encounteredCorruption ||= loaded.status === 'corrupt';
  }

  return {
    status: 'ready',
    system: options.createSystem(),
    isBrandNew: true,
    encounteredCorruption,
  };
}
