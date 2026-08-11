import { useEffect, useRef, useState } from 'react';
import { useEditor, useEditorCommands } from '../editor/EditorProvider';
import { getMap } from '../map/mapRef';
import {
  IMPORT_CATEGORY_LABELS,
  IMPORT_CATEGORY_ORDER,
  importOsmWays,
  type ImportCategory,
} from '@transitmapper/core/model/import';
import { useOnlineStatus } from '../network/useOnlineStatus';
import { Icon } from './Icon';
import { Modal } from './Modal';

// Below this zoom the visible area is too large for a responsible Overpass
// query (slow, or likely to time out / return an unreasonable amount of data).
const MIN_IMPORT_ZOOM = 13;

interface ImportDialogProps {
  onClose: () => void;
}

export function ImportDialog({ onClose }: ImportDialogProps) {
  const { applyImportedNetwork } = useEditorCommands().imports;
  const drivingSide = useEditor((s) => s.system.drivingSide);
  const activeSystemId = useEditor((s) => s.system.id);
  const [categories, setCategories] = useState<Set<ImportCategory>>(
    () => new Set(['road', 'bike']),
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [count, setCount] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const online = useOnlineStatus();

  const toggle = (c: ImportCategory) =>
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  // The modal's own backdrop blocks the map behind it, so the zoom that
  // determines zoomedInEnough can't change on its own while this is open —
  // without a way to fix that from inside the dialog, a disabled button here
  // is a dead end (close, zoom, reopen, hope it's enough). Tracked in state
  // (not read fresh each render) so the map's own "zoomend" pushes a re-check.
  const [zoom, setZoom] = useState(() => getMap()?.getZoom() ?? 0);
  const zoomedInEnough = zoom >= MIN_IMPORT_ZOOM;

  useEffect(() => {
    const map = getMap();
    if (!map) return;
    const onZoom = () => setZoom(map.getZoom());
    map.on('zoomend', onZoom);
    return () => {
      map.off('zoomend', onZoom);
    };
  }, []);
  useEffect(
    () => () => {
      request.current?.abort(new DOMException('Import dialog unmounted.', 'AbortError'));
    },
    [],
  );

  const zoomIn = () => getMap()?.zoomTo(MIN_IMPORT_ZOOM, { duration: 300 });
  const close = () => {
    request.current?.abort(new DOMException('Import dialog closed.', 'AbortError'));
    onClose();
  };

  const run = async () => {
    const map = getMap();
    if (!map || categories.size === 0) return;
    const controller = new AbortController();
    const targetSystemId = activeSystemId;
    request.current = controller;
    setStatus('loading');
    setError('');
    try {
      const b = map.getBounds();
      const network = await importOsmWays(
        { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        [...categories],
        drivingSide,
        { signal: controller.signal },
      );
      const imported = applyImportedNetwork({ targetSystemId, network });
      if (!imported) {
        setError('This system can no longer accept that import. Nothing was changed.');
        setStatus('error');
        return;
      }
      const { added, skipped: alreadyHere } = imported;
      setCount(added);
      setSkipped(alreadyHere);
      setStatus('done');
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Import failed.');
      setStatus('error');
    } finally {
      if (request.current === controller) request.current = null;
    }
  };

  return (
    <Modal
      title="Import real streets"
      description="Pull OpenStreetMap infrastructure within the current map view into ways you can build services over."
      onClose={close}
      footer={
        <button
          className="primary-btn"
          style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}
          disabled={!zoomedInEnough || categories.size === 0 || status === 'loading'}
          onClick={() => void run()}
        >
          <Icon name="download" size={18} />{' '}
          {status === 'loading' ? 'Importing…' : 'Import into this system'}
        </button>
      }
    >
      <p className="panel-hint">
        Pulls OpenStreetMap infrastructure within the current map view into ways you can build
        services over — real streets, rail, and bike routes as a starting point.
      </p>

      <div
        className="chip-row"
        role="group"
        aria-label="Categories to import"
        style={{ marginTop: 8 }}
      >
        {IMPORT_CATEGORY_ORDER.map((c) => (
          <button
            key={c}
            className={`chip ${categories.has(c) ? 'active' : ''}`}
            aria-pressed={categories.has(c)}
            onClick={() => toggle(c)}
          >
            {IMPORT_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {!zoomedInEnough && (
        <p
          className="error-text"
          style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}
        >
          This area's too big to pull streets for all at once.
          <button type="button" className="link-btn" onClick={zoomIn}>
            Zoom in
          </button>
        </p>
      )}

      {/* Offline is named rather than guessed at. When there IS a network the
          message stays as it was: a failed Overpass request is far more often
          the service being busy than anything about this browser, and
          packages/core's import.ts already words that carefully. */}
      {status === 'error' && (
        <p className="error-text" style={{ marginTop: 8 }}>
          {online
            ? error
            : 'You’re offline, so streets couldn’t be fetched. Importing reads from OpenStreetMap, which needs a connection — everything already in your system is untouched.'}
        </p>
      )}
      {status === 'done' && (
        <p className="panel-hint" style={{ marginTop: 8 }}>
          {count === 0 && skipped > 0
            ? `This area is already in your system — all ${skipped} street${skipped === 1 ? ' was' : 's were'} imported before.`
            : `Imported ${count} way${count === 1 ? '' : 's'}${skipped > 0 ? `, skipping ${skipped} already in this system` : ''}. They start as bare infrastructure — draw a service over any of them from the Way inspector.`}
        </p>
      )}
    </Modal>
  );
}
