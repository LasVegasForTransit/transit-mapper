import { createPublishedView, deletePublishedView, updatePublishedView } from './api';
import { createIndexedDbLocalViewLibrary, type LocalViewLibrary } from './local-view-library';
import type {
  CreatePublication,
  DeletePublication,
  PublishSystem,
  UpdatePublication,
} from './saved-views';
import { getOrCreateShare } from '../share/api';

export interface SavedViewsServices {
  library: LocalViewLibrary;
  publishSystem: PublishSystem;
  createPublication: CreatePublication;
  updatePublication: UpdatePublication;
  deletePublication: DeletePublication;
  createId?: () => string;
  now?: () => number;
}

export function resourceFromShareUrl(url: string): { id: string; url: string } {
  const parsed = new URL(url, window.location.origin);
  const match = /^\/s\/([^/]+)$/.exec(parsed.pathname);
  if (!match) throw new Error('The system share returned an invalid link.');
  return { id: decodeURIComponent(match[1]), url: parsed.href };
}

export function browserSavedViewsServices(): SavedViewsServices {
  return {
    library: createIndexedDbLocalViewLibrary(window.indexedDB),
    publishSystem: async (system, options) =>
      resourceFromShareUrl(await getOrCreateShare(system, options)),
    createPublication: createPublishedView,
    updatePublication: updatePublishedView,
    deletePublication: deletePublishedView,
  };
}
