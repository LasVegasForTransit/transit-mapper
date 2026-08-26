import type { TransitSystem } from '@transitmapper/core/model/system';
import type { MapViewStore, SelectionController } from '@transitmapper/map';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import type { LocalViewRecord } from '../views/local-view-library';
import {
  deleteSavedView,
  nextSavedViewTitle,
  publishSavedView,
  renameSavedView,
  saveCurrentView,
} from '../views/saved-views';
import type { SavedViewsServices } from '../views/saved-views-services';

function replaceView(views: readonly LocalViewRecord[], updated: LocalViewRecord) {
  return [updated, ...views.filter((view) => view.id !== updated.id)].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

interface CollectionOptions {
  system: TransitSystem;
  viewStore: MapViewStore;
  selection: SelectionController;
  services: SavedViewsServices;
}

function useSavedViewCollection(options: CollectionOptions) {
  const [views, setViews] = useState<LocalViewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [libraryError, setLibraryError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setViews(await options.services.library.list(options.system.id));
      setLibraryError(false);
    } catch {
      setLibraryError(true);
    } finally {
      setLoading(false);
    }
  }, [options.services, options.system.id]);

  useEffect(() => void load(), [load]);

  const startCreate = () => {
    setCreateDraft(nextSavedViewTitle(views));
    setCreating(true);
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!createDraft.trim()) return;
    try {
      const view = await saveCurrentView({
        documentId: options.system.id,
        title: createDraft,
        viewStore: options.viewStore,
        selection: options.selection,
        library: options.services.library,
        createId: options.services.createId,
        now: options.services.now,
      });
      setViews((current) => replaceView(current, view));
      setCreating(false);
    } catch (error) {
      setLibraryError(true);
      console.error('[transitmapper] save view', error);
    }
  };
  return {
    views,
    setViews,
    loading,
    libraryError,
    creating,
    createDraft,
    setCreateDraft,
    startCreate,
    cancelCreate: () => setCreating(false),
    create,
    load,
  };
}

function useRowRunner() {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(
    () => () => activeRequest.current?.abort(new DOMException('Dialog closed.', 'AbortError')),
    [],
  );
  const run = async (id: string, operation: (signal: AbortSignal) => Promise<void>) => {
    activeRequest.current?.abort(new DOMException('A newer action started.', 'AbortError'));
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusyId(id);
    setErrors((current) => ({ ...current, [id]: '' }));
    try {
      await operation(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        setErrors((current) => ({
          ...current,
          [id]: error instanceof Error ? error.message : 'The action could not be completed.',
        }));
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setBusyId(null);
      }
    }
  };
  return {
    busyId,
    errors,
    run,
    setError: (id: string, error: Error) =>
      setErrors((current) => ({ ...current, [id]: error.message })),
  };
}

interface OperationOptions {
  system: TransitSystem;
  services: SavedViewsServices;
  setViews: Dispatch<SetStateAction<LocalViewRecord[]>>;
}

function useSavedViewOperations(options: OperationOptions) {
  const runner = useRowRunner();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revealedLinkId, setRevealedLinkId] = useState<string | null>(null);
  const rename = (view: LocalViewRecord, title: string) =>
    void runner.run(view.id, async (signal) => {
      const result = await renameSavedView({
        view,
        title,
        library: options.services.library,
        updatePublication: options.services.updatePublication,
        now: options.services.now,
        signal,
      });
      options.setViews((current) => replaceView(current, result.view));
      setEditingId(null);
      if (result.publicationError) runner.setError(view.id, result.publicationError);
    });
  const share = (view: LocalViewRecord) =>
    void runner.run(view.id, async (signal) => {
      const published = await publishSavedView({
        view,
        system: options.system,
        library: options.services.library,
        publishSystem: options.services.publishSystem,
        createPublication: options.services.createPublication,
        updatePublication: options.services.updatePublication,
        now: options.services.now,
        signal,
      });
      options.setViews((current) => replaceView(current, published));
      setRevealedLinkId(published.id);
    });
  const remove = (view: LocalViewRecord) =>
    void runner.run(view.id, async (signal) => {
      await deleteSavedView({
        view,
        library: options.services.library,
        deletePublication: options.services.deletePublication,
        signal,
      });
      options.setViews((current) => current.filter((candidate) => candidate.id !== view.id));
      setConfirmingId(null);
    });
  return {
    ...runner,
    editingId,
    confirmingId,
    revealedLinkId,
    startRename: setEditingId,
    cancelRename: () => setEditingId(null),
    requestDelete: setConfirmingId,
    cancelDelete: () => setConfirmingId(null),
    rename,
    share,
    remove,
  };
}

export function useSavedViewsDialogState(options: CollectionOptions) {
  const collection = useSavedViewCollection(options);
  const operations = useSavedViewOperations({
    system: options.system,
    services: options.services,
    setViews: collection.setViews,
  });
  return { ...collection, ...operations };
}
