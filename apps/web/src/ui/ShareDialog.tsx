import { useEffect, useState } from 'react';
import { useMapViewStore } from '@transitmapper/workspace';
import { useEditor } from '../editor/EditorProvider';
import { getOrCreateShare, stopSharing } from '../share/api';
import { getMyShare } from '../share/myShares';
import { withDocumentCamera } from '../editor/document-view-adapter';
import { useOnlineStatus } from '../network/useOnlineStatus';
import { Icon } from './Icon';
import { Modal } from './Modal';

interface ShareDialogProps {
  onClose: () => void;
}

type Status = 'loading' | 'done' | 'error' | 'stopped';

/** Google Docs-style: one link per document, always the same one. Opening
 *  this dialog again — changed or not — never produces a second URL; see
 *  share/api.ts#getOrCreateShare for how that's guaranteed. */
export function ShareDialog({ onClose }: ShareDialogProps) {
  const system = useEditor((s) => s.system);
  const mapViewStore = useMapViewStore();
  const [status, setStatus] = useState<Status>('loading');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const online = useOnlineStatus();
  // Only a share this browser holds the edit token for can be stopped — a
  // dedup hit onto someone else's row isn't ours to revoke.
  const [revocable, setRevocable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    // Fold in the View camera so the shared link opens where the user is now.
    // The saved document camera changes only at serialization boundaries.
    getOrCreateShare(withDocumentCamera(system, mapViewStore), { signal: controller.signal })
      .then((sharedUrl) => {
        if (cancelled) return;
        setUrl(sharedUrl);
        setRevocable(getMyShare(system.id) !== null);
        setStatus('done');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Sharing failed.');
        setStatus('error');
      });
    return () => {
      cancelled = true;
      controller.abort(new DOMException('Share dialog closed.', 'AbortError'));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the snapshot is taken once, at open
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — the field is selectable as a fallback
    }
  };

  const stop = async () => {
    try {
      await stopSharing(system.id);
      setStatus('stopped');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sharing could not be stopped.');
      setStatus('error');
    }
  };

  return (
    <Modal
      title="Share this system"
      description="Create a shareable, read-only link to this system."
      onClose={onClose}
    >
      {status === 'loading' && <p className="panel-hint">Creating a shareable link…</p>}

      {/* Being offline is named because it is the one cause the reader can do
          something about, and because "Something went wrong. Failed to fetch"
          is what they got instead. The exception text still follows when there
          is a network, since then it is the only clue anyone has. */}
      {status === 'error' &&
        (online ? (
          <p className="error-text">Something went wrong. {error}</p>
        ) : (
          <p className="error-text">
            You’re offline, so this link couldn’t be created. Sharing needs a connection because the
            link is served from TransitMapper rather than from this device — your system is
            untouched, and this works again once you reconnect.
          </p>
        ))}

      {status === 'stopped' && (
        <p className="panel-hint">This link no longer works. Share again to create a new one.</p>
      )}

      {status === 'done' && (
        <>
          <p className="panel-hint">
            Anyone with this link can view the system and fork their own copy. Sharing again from
            this browser updates this same link instead of creating a new one.
          </p>
          <div className="share-row">
            <input className="share-url" value={url} readOnly onFocus={(e) => e.target.select()} />
            <button className="primary-btn" onClick={() => void copy()}>
              <Icon name="copy" size={18} /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          {revocable && (
            <button
              type="button"
              className="ghost-btn"
              style={{ marginTop: 8 }}
              onClick={() => void stop()}
            >
              Stop sharing
            </button>
          )}
        </>
      )}
    </Modal>
  );
}
