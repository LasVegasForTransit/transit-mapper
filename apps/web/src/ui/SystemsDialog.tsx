import { useEffect, useState } from 'react';
import { useEditor } from '../editor/EditorProvider';
import { createEmptySystem, forkSystem } from '@transitmapper/core/model/serialize';
import {
  deleteFromLibrary,
  listLibrary,
  loadSystemById,
  loadSystemEntry,
  saveToLibrary,
  type LibraryEntry,
} from '../storage/browserLibrary';
import { setActiveId } from '../storage/localStore';
import { deleteAfterFlush } from '../storage/deleteAfterFlush';
import { getMyShare } from '../share/myShares';
import { stopSharing } from '../share/api';
import { useSaveStatus } from './SaveStatusProvider';
import { blurOnEnter } from './formUtils';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Modal } from './Modal';

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
  flushPendingSave: () => void | Promise<void>;
  /** Reports a stored system that exists but won't parse, so the app can say
   *  so — the row stays in the list and its bytes stay on disk. */
  onCorrupt: () => void;
}

/** Replaces the old single-slot autosave with a real library: every saved
 *  system its own row, switch between them without losing anything, rename/
 *  duplicate/delete in place. See storage/localStore.ts for the storage
 *  shape this reads and writes. */
export function SystemsDialog({ onClose, onCorrupt, flushPendingSave }: SystemsDialogProps) {
  const currentId = useEditor((s) => s.system.id);
  const currentName = useEditor((s) => s.system.name);
  const setName = useEditor((s) => s.setName);
  const setSystem = useEditor((s) => s.setSystem);
  // Every write below goes through this. Without it a rename or duplicate
  // that hits a full quota simply doesn't happen, and the row silently snaps
  // back to its old value with no explanation anywhere.
  const { report } = useSaveStatus();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const refresh = async () => {
    setEntries(await listLibrary());
    setLoading(false);
  };

  useEffect(() => {
    let disposed = false;
    void listLibrary().then((next) => {
      if (!disposed) {
        setEntries(next);
        setLoading(false);
      }
    });
    return () => {
      disposed = true;
    };
  }, []);

  const open = async (id: string) => {
    if (id === currentId) return;
    // A row whose bytes won't parse is listed, clickable, and used to do
    // absolutely nothing when clicked — forever, with no message.
    const result = await loadSystemEntry(id);
    if (result.status === 'corrupt') {
      onCorrupt();
      return;
    }
    if (result.status !== 'ok') return;
    const system = result.system;
    setActiveId(id);
    setSystem(system, { readOnly: false });
    onClose();
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
      const system = await loadSystemById(entry.id);
      if (!system) return;
      const outcome = await saveToLibrary({ ...system, name, updatedAt });
      report(outcome);
      if (outcome !== 'saved') await refresh();
    })();
  };

  const duplicate = async (entry: LibraryEntry) => {
    const system = await loadSystemById(entry.id);
    if (!system) return;
    report(await saveToLibrary(forkSystem(system)));
    await refresh();
  };

  const startNew = () => {
    const system = createEmptySystem();
    setActiveId(system.id);
    // The store transition enters the shared persistence coordinator, which
    // saves this immutable snapshot and reports its outcome once.
    setSystem(system, { readOnly: false });
    onClose();
  };

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
    });
    report(outcome);
    if (outcome === 'saved' && id === currentId) {
      const remaining = await listLibrary();
      const next =
        remaining.length > 0 ? await loadSystemById(remaining[0].id) : createEmptySystem();
      if (next) {
        setActiveId(next.id);
        setSystem(next, { readOnly: false });
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
    >
      <p className="panel-hint">
        Saved on this device only — use Share to send a system to someone else.
      </p>

      <ul className="systems-list" aria-busy={loading}>
        {loading && <li className="panel-hint">Loading saved systems…</li>}
        {entries.map((entry) => {
          const isActive = entry.id === currentId;
          const isConfirming = confirmingId === entry.id;
          return (
            <li key={entry.id} className={`systems-row ${isActive ? 'active' : ''}`}>
              <button
                type="button"
                className="systems-open"
                onClick={() => void open(entry.id)}
                disabled={isActive}
                aria-label={isActive ? 'Current system' : `Open ${entry.name || 'Untitled system'}`}
                title={isActive ? 'Current system' : 'Open'}
              >
                <span className={`dot ${isActive ? '' : 'ring'}`} />
              </button>
              <input
                className="systems-name-input"
                value={isActive ? currentName : entry.name}
                aria-label="System name"
                onChange={(e) => rename(entry, e.target.value)}
                onKeyDown={blurOnEnter}
              />
              <span className="systems-meta">
                {isActive ? 'Current' : relativeTime(entry.updatedAt)}
              </span>
              {getMyShare(entry.id) && (
                <IconButton
                  icon="share"
                  size={16}
                  active
                  label="Shared — stop sharing"
                  onClick={() => revokeShare(entry.id)}
                />
              )}
              <IconButton
                icon="copy"
                size={16}
                label="Duplicate"
                onClick={() => void duplicate(entry)}
              />
              {isConfirming ? (
                <span className="systems-confirm">
                  <button
                    type="button"
                    className="danger-btn systems-confirm-btn"
                    onClick={() => void confirmDelete(entry.id)}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="ghost-btn systems-confirm-btn"
                    onClick={() => setConfirmingId(null)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <IconButton
                  icon="trash"
                  size={16}
                  label="Delete"
                  onClick={() => setConfirmingId(entry.id)}
                />
              )}
            </li>
          );
        })}
      </ul>

      <button type="button" className="ghost-btn" style={{ marginTop: 8 }} onClick={startNew}>
        <Icon name="plus" size={17} /> New system
      </button>
    </Modal>
  );
}
