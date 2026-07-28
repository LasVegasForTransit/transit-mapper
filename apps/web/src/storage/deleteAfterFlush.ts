import type { SaveOutcome } from './localStore';

export interface DeleteAfterFlushOptions {
  flush: () => void | Promise<void>;
  deleteDocument: (id: string) => Promise<SaveOutcome>;
  discardDocument: (id: string) => void;
}

/** A pending autosave captured before deletion would otherwise commit after
 * the delete and resurrect the document. Establish the durability boundary
 * first, then remove both IndexedDB and legacy copies. */
export async function deleteAfterFlush(
  id: string,
  options: DeleteAfterFlushOptions,
): Promise<SaveOutcome> {
  await options.flush();
  const outcome = await options.deleteDocument(id);
  if (outcome === 'saved') options.discardDocument(id);
  return outcome;
}
