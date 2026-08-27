import { useEffect, useRef, useState } from 'react';
import { useEditor, useEditorCommands } from '../editor/EditorProvider';
import { createEmptySystem, forkSystem } from '@transitmapper/core/model/serialize';
import {
  deleteFromLibrary,
  listLibrary,
  loadSystemEntry,
  saveToLibrary,
  type LibraryEntry,
  type SaveOutcome,
} from '../storage/browserLibrary';
import { setActiveId } from '../storage/localStore';
import { deleteAfterFlush } from '../storage/deleteAfterFlush';
import { getMyShare } from '../share/myShares';
import { stopSharing } from '../share/api';
import { renderPreviewMarkup } from '../share/previewWorker';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { SystemLibraryEntry } from './system-library-entry';
import { loadSystemPreviews, type SystemPreview } from './system-previews';
import { readSystemsView, writeSystemsView, type SystemsView } from './systems-view-preference';
import { useUi } from './UiProvider';

function relativeTime(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

interface SystemsDialogProps {
  onClose: () => void;
  flushPendingSave: () => Promise<SaveOutcome>;
  recordSaveOutcome: (id: string, outcome: SaveOutcome) => void;
  discardPendingSave: (id: string) => void;
  /** Reports a stored system that exists but won't parse, so the app can say
   *  so — the row stays in the list and its bytes stay on disk. */
  onCorrupt: () => void;
}

interface SelectReplacementOptions {
  remaining: LibraryEntry[];
  onCorrupt: () => void;
  onUnavailable: () => void;
  setSystem: ReturnType<typeof useEditorCommands>['document']['setSystem'];
}

async function selectReplacementAfterDelete({
  remaining,
  onCorrupt,
  onUnavailable,
  setSystem,
}: SelectReplacementOptions): Promise<void> {
  const first = remaining.at(0);
  if (!first) {
    const next = createEmptySystem();
    setActiveId(next.id);
    setSystem(next);
    return;
  }

  const loaded = await loadSystemEntry(first.id);
  if (loaded.status === 'unavailable') {
    onUnavailable();
    return;
  }
  if (loaded.status === 'corrupt') {
    onCorrupt();
    return;
  }
  if (loaded.status === 'missing') return;
  setActiveId(loaded.system.id);
  setSystem(loaded.system);
}

/** Gives each saved system its own row with switching, rename, duplication,
 *  and deletion. See storage/browserLibrary.ts for the durable
 *  IndexedDB path and its localStorage recovery boundary. */
export function SystemsDialog({
  onClose,
  onCorrupt,
  flushPendingSave,
  recordSaveOutcome,
  discardPendingSave,
}: SystemsDialogProps) {
  const currentId = useEditor((s) => s.system.id);
  const currentName = useEditor((s) => s.system.name);
  const { setName, setSystem } = useEditorCommands().document;
  const { openNewSystemLocation } = useUi();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [libraryUnavailable, setLibraryUnavailable] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openingIdRef = useRef<string | null>(null);
  const [view, setView] = useState<SystemsView>(readSystemsView);
  const [previews, setPreviews] = useState<Record<string, SystemPreview>>({});
  const previewIdsRef = useRef(new Set<string>());

  const refresh = async (): Promise<LibraryEntry[] | null> => {
    const result = await listLibrary();
    setLoading(false);
    if (result.status === 'unavailable') {
      setLibraryUnavailable(true);
      return null;
    }
    setLibraryUnavailable(false);
    setEntries(result.entries);
    return result.entries;
  };

  useEffect(() => {
    let disposed = false;
    void listLibrary().then((result) => {
      if (!disposed) {
        setLoading(false);
        if (result.status === 'unavailable') {
          setLibraryUnavailable(true);
        } else {
          setLibraryUnavailable(false);
          setEntries(result.entries);
        }
      }
    });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (view !== 'cards' || entries.length === 0) return;
    const previewIds = previewIdsRef.current;
    const entryIds = new Set(entries.map((entry) => entry.id));
    for (const id of previewIds) {
      if (!entryIds.has(id)) previewIds.delete(id);
    }
    setPreviews((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => entryIds.has(id))),
    );
    const ids = entries.filter((entry) => !previewIds.has(entry.id)).map((entry) => entry.id);
    if (ids.length === 0) return;
    for (const id of ids) previewIds.add(id);

    let cancelled = false;
    const completed = new Set<string>();
    void loadSystemPreviews({
      ids,
      load: loadSystemEntry,
      // The editor already ships the share-preview Worker. Reusing it keeps
      // geometry-heavy rendering off the input thread and out of the measured
      // editor JavaScript graph while preserving card-sized detail choices.
      render: (system) =>
        renderPreviewMarkup(JSON.stringify(system), {
          displayWidth: 280,
        }),
      onPreview: (id, preview) => {
        completed.add(id);
        setPreviews((current) => ({ ...current, [id]: preview }));
      },
      isCancelled: () => cancelled,
    });
    return () => {
      cancelled = true;
      for (const id of ids) {
        if (!completed.has(id)) previewIds.delete(id);
      }
    };
  }, [entries, view]);

  const open = async (id: string) => {
    if (id === currentId || openingIdRef.current !== null) return;
    openingIdRef.current = id;
    setOpeningId(id);
    try {
      // Replacing the editor before this settles can discard the only copy of
      // the current document's last edits. A save failure already has a banner
      // with the right remedy, so leave this dialog open and keep Delete usable.
      if ((await flushPendingSave()) !== 'saved') return;

      // A row whose bytes won't parse is listed, clickable, and used to do
      // absolutely nothing when clicked — forever, with no message.
      const result = await loadSystemEntry(id);
      if (result.status === 'unavailable') {
        setLibraryUnavailable(true);
        return;
      }
      if (result.status === 'corrupt') {
        onCorrupt();
        return;
      }
      if (result.status === 'missing') {
        await refresh();
        return;
      }
      const system = result.system;
      setActiveId(id);
      setSystem(system);
      onClose();
    } finally {
      openingIdRef.current = null;
      setOpeningId(null);
    }
  };

  const selectView = (next: SystemsView): void => {
    setView(next);
    writeSystemsView(next);
  };

  const rename = (entry: LibraryEntry, name: string) => {
    if (entry.id === currentId) {
      setName(name);
      return;
    }
    const updatedAt = Date.now();
    setEntries((current) =>
      current.map((candidate) =>
        candidate.id === entry.id ? { ...candidate, name, updatedAt } : candidate,
      ),
    );
    void (async () => {
      const loaded = await loadSystemEntry(entry.id);
      if (loaded.status === 'unavailable') {
        setLibraryUnavailable(true);
        return;
      }
      if (loaded.status !== 'ok') return;
      const outcome = await saveToLibrary({ ...loaded.system, name, updatedAt });
      recordSaveOutcome(entry.id, outcome);
      if (outcome !== 'saved') await refresh();
    })();
  };

  const duplicate = async (entry: LibraryEntry) => {
    const loaded = await loadSystemEntry(entry.id);
    if (loaded.status === 'unavailable') {
      setLibraryUnavailable(true);
      return;
    }
    if (loaded.status !== 'ok') return;
    const duplicateSystem = forkSystem(loaded.system);
    recordSaveOutcome(duplicateSystem.id, await saveToLibrary(duplicateSystem));
    await refresh();
  };

  // Opens the location-picker dialog in place of this one — one modal slot,
  // so choosing "New system" here hands off to it rather than creating a
  // blank system directly the way this used to.
  const startNew = () => openNewSystemLocation('create');

  const revokeShare = async (id: string) => {
    try {
      await stopSharing(id);
    } catch {
      // Best-effort: if the request failed the server-side share is still
      // live, but the local record is what the icon below reflects either
      // way — surfacing a toast here isn't worth it for a secondary action.
    }
    await refresh();
  };

  const confirmDelete = async (id: string) => {
    // Reported like any other write: a delete is how the user is told to free
    // space when storage is full, so it failing silently would leave them
    // following advice that quietly does nothing.
    const outcome = await deleteAfterFlush(id, {
      flush: flushPendingSave,
      deleteDocument: deleteFromLibrary,
      discardDocument: discardPendingSave,
    });
    if (outcome !== 'saved') recordSaveOutcome(id, outcome);
    if (outcome === 'saved' && id === currentId) {
      const remaining = await refresh();
      if (remaining) {
        await selectReplacementAfterDelete({
          remaining,
          onCorrupt,
          onUnavailable: () => setLibraryUnavailable(true),
          setSystem,
        });
      }
    }
    setConfirmingId(null);
    await refresh();
  };

  return (
    <Modal
      title="My systems"
      description="Every system you've saved locally — switch, rename, duplicate, or delete."
      onClose={onClose}
      className="systems-dialog"
    >
      <p className="panel-hint systems-hint">
        Saved on this device only — use Share to send a system to someone else.
      </p>
      <div className="systems-toolbar">
        <button
          type="button"
          className="btn btn-primary systems-new"
          onClick={startNew}
          disabled={libraryUnavailable || openingId !== null}
        >
          <Icon name="plus" size={17} /> New system
        </button>
        <div className="systems-view-toggle" role="group" aria-label="System view">
          <button
            type="button"
            className="systems-view-btn"
            aria-label="List view"
            aria-pressed={view === 'list'}
            onClick={() => selectView('list')}
          >
            <Icon name="platform" size={16} /> List
          </button>
          <button
            type="button"
            className="systems-view-btn"
            aria-label="Cards view"
            aria-pressed={view === 'cards'}
            onClick={() => selectView('cards')}
          >
            <Icon name="square" size={16} /> Cards
          </button>
        </div>
      </div>

      <ul className="systems-list" data-view={view} aria-busy={loading}>
        {loading && <li className="panel-hint">Loading saved systems…</li>}
        {libraryUnavailable && (
          <li className="panel-hint">
            Saved systems are temporarily unavailable.{' '}
            <button type="button" className="ghost-btn" onClick={() => void refresh()}>
              Try again
            </button>
          </li>
        )}
        {!loading && !libraryUnavailable && entries.length === 0 && (
          <li className="systems-empty">
            <Icon name="layers" size={24} />
            <span>No saved systems yet.</span>
            <span>Create one to start drawing your network.</span>
          </li>
        )}
        {entries.map((entry) => (
          <SystemLibraryEntry
            key={entry.id}
            currentName={currentName}
            entry={entry}
            isActive={entry.id === currentId}
            isConfirming={confirmingId === entry.id}
            openingId={openingId}
            preview={previews[entry.id]}
            relativeUpdatedAt={relativeTime(entry.updatedAt)}
            shared={Boolean(getMyShare(entry.id))}
            view={view}
            onCancelDelete={() => setConfirmingId(null)}
            onConfirmDelete={(id) => void confirmDelete(id)}
            onDuplicate={(candidate) => void duplicate(candidate)}
            onOpen={(id) => void open(id)}
            onRename={rename}
            onRequestDelete={setConfirmingId}
            onRevokeShare={(id) => void revokeShare(id)}
          />
        ))}
      </ul>
    </Modal>
  );
}
