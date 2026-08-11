import { useEffect, useRef, useState } from 'react';
import { useEditor, useEditorCommands } from '../../editor/EditorProvider';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { searchPlaces, type PlaceResult } from '@transitmapper/core/model/geocode';
import type { DrivingSide, LngLat } from '@transitmapper/core/model/system';
import { importOsmNetwork } from '../../import/import-osm-network';
import { setActiveId } from '../../storage/localStore';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { LocationPickerMap, type LocationPickerMapHandle } from './LocationPickerMap';

// ImportDialog.tsx enforces a minimum zoom (13) so a manual import can't
// request an unreasonably large area. This dialog never needs that check:
// it always flies to a fixed, comfortably-above-the-floor zoom before
// reading bounds, rather than importing whatever the map already happens to
// show.
const PICK_ZOOM = 16;
const SEARCH_DEBOUNCE_MS = 400;

// Countries (ISO 3166-1 alpha-2, lowercase) that drive on the left — used
// only to pre-select a new system's driving side from a picked place; the
// user can always override it before confirming.
const LEFT_DRIVING_COUNTRIES = new Set([
  'gb',
  'ie',
  'jp',
  'au',
  'nz',
  'in',
  'za',
  'th',
  'sg',
  'my',
  'id',
  'hk',
  'mo',
  'pk',
  'lk',
  'bd',
  'np',
  'ke',
  'tz',
  'ug',
  'mt',
  'cy',
  'jm',
  'bs',
  'bb',
]);

interface NewSystemLocationDialogProps {
  onClose: () => void;
  /** 'create' builds and activates a brand-new blank system once a location
   *  is confirmed — the File-menu and Systems-dialog entry points, which
   *  have no system yet. 'importIntoActive' assumes the currently active
   *  system already exists (first-run bootstrap already created one for
   *  resilience before this dialog ever opens) and only sets its viewport
   *  and imports into it. */
  mode: 'create' | 'importIntoActive';
}

type Status = 'idle' | 'importing' | 'error';
export function NewSystemLocationDialog({ onClose, mode }: NewSystemLocationDialogProps) {
  const commands = useEditorCommands();
  const activeSystemId = useEditor((state) => state.system.id);
  const activeDrivingSide = useEditor((state) => state.system.drivingSide);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<{ center: LngLat; drivingSide?: DrivingSide } | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const mapHandle = useRef<LocationPickerMapHandle>(null);
  const importAbort = useRef<AbortController | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the most recent flyTo so confirm() can wait for the camera to
  // actually settle before reading getBounds() — whichever of choosePlace/
  // pickOnMap ran last "wins," same as the picked state itself.
  const settled = useRef<Promise<void>>(Promise.resolve());
  useEffect(
    () => () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      searchAbort.current?.abort(new DOMException('Dialog closed.', 'AbortError'));
      importAbort.current?.abort(new DOMException('Dialog closed.', 'AbortError'));
    },
    [],
  );
  const runSearch = (q: string) => {
    searchAbort.current?.abort(new DOMException('Superseded by a newer search.', 'AbortError'));
    if (q.trim().length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    void searchPlaces(q, { signal: controller.signal })
      .then((found) => {
        if (controller.signal.aborted) return;
        setResults(found);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResults([]);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setSearching(false);
      });
  };
  const onQueryChange = (value: string) => {
    setQuery(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => runSearch(value), SEARCH_DEBOUNCE_MS);
  };
  const choosePlace = (place: PlaceResult) => {
    setPicked({
      center: place.center,
      drivingSide: place.countryCode
        ? LEFT_DRIVING_COUNTRIES.has(place.countryCode.toLowerCase())
          ? 'left'
          : 'right'
        : undefined,
    });
    setResults([]);
    setQuery(place.label);
    settled.current = mapHandle.current?.flyTo(place.center, PICK_ZOOM) ?? Promise.resolve();
  };
  const pickOnMap = (center: LngLat) => {
    setPicked((prev) => ({ center, drivingSide: prev?.drivingSide }));
    settled.current = mapHandle.current?.flyTo(center, PICK_ZOOM) ?? Promise.resolve();
  };
  const confirm = async () => {
    if (!picked) return;
    setStatus('importing');
    setError('');
    const controller = new AbortController();
    importAbort.current = controller;
    try {
      const drivingSide: DrivingSide =
        picked.drivingSide ?? (mode === 'importIntoActive' ? activeDrivingSide : 'right');
      let targetSystemId = activeSystemId;
      if (mode === 'create') {
        const system = createEmptySystem();
        system.viewport = { center: picked.center, zoom: PICK_ZOOM };
        system.drivingSide = drivingSide;
        setActiveId(system.id);
        // System exists and is active BEFORE import is attempted — if
        // Overpass is down the user still lands on a real, correctly
        // centered empty system instead of stuck behind this dialog.
        commands.document.setSystem(system, { readOnly: false });
        targetSystemId = system.id;
      } else {
        commands.document.setViewport({ center: picked.center, zoom: PICK_ZOOM });
        if (picked.drivingSide) commands.network.setDrivingSide(picked.drivingSide);
      }
      // Wait for the camera to actually settle, then read the SAME
      // map.getBounds()-at-current-zoom convention ImportDialog.tsx uses —
      // not an approximation from center+zoom alone.
      await settled.current;
      const bbox = mapHandle.current?.getBounds();
      if (!bbox) throw new Error('Map is not ready yet — try again.');
      const network = await importOsmNetwork(bbox, ['road', 'bike'], drivingSide, {
        signal: controller.signal,
      });
      const imported = commands.imports.applyImportedNetwork({ targetSystemId, network });
      if (!imported) {
        setError('This system can no longer accept that import. Nothing was changed.');
        setStatus('error');
        return;
      }
      commands.tools.setTool('way');
      onClose();
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'Import failed.');
      setStatus('error');
    } finally {
      if (importAbort.current === controller) importAbort.current = null;
    }
  };

  const skip = () => {
    if (mode === 'create') {
      const system = createEmptySystem();
      if (picked) {
        system.viewport = { center: picked.center, zoom: PICK_ZOOM };
        if (picked.drivingSide) system.drivingSide = picked.drivingSide;
      }
      setActiveId(system.id);
      commands.document.setSystem(system, { readOnly: false });
      commands.tools.setTool('way');
    }
    onClose();
  };

  return (
    <Modal
      title="Start a new system"
      description="Pick a real place to start from — its streets import automatically, so you build over reality instead of a blank canvas."
      onClose={onClose}
      className="new-system-modal"
      footer={
        <div className="new-system-footer">
          <button
            type="button"
            className="ghost-btn"
            onClick={skip}
            disabled={status === 'importing'}
          >
            Continue with a blank canvas
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!picked || status === 'importing'}
            onClick={() => void confirm()}
          >
            <Icon name="download" size={18} />{' '}
            {status === 'importing' ? 'Importing…' : 'Use this location'}
          </button>
        </div>
      }
    >
      <p className="panel-hint">
        Search for a city or address, or click the map to drop a pin. Real streets within a couple
        blocks of the pin import automatically — you can pull in more, or clear out what doesn't
        belong, once you're in.
      </p>
      <div className="new-system-search">
        <input
          className="new-system-search-input"
          type="text"
          value={query}
          placeholder="Search for a place…"
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Search for a place"
        />
        {searching && <span className="panel-hint">Searching…</span>}
        {results.length > 0 && (
          <ul className="new-system-results">
            {results.map((r) => (
              <li key={`${r.center[0]},${r.center[1]}`}>
                <button type="button" onClick={() => choosePlace(r)}>
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="new-system-map-wrap">
        <LocationPickerMap handleRef={mapHandle} onPick={pickOnMap} />
      </div>
      {status === 'error' && (
        <p className="error-text" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
    </Modal>
  );
}
