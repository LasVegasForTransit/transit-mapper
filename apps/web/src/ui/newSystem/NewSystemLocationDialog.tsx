import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { PlaceResult } from '@transitmapper/core/model/geocode';
import type { DrivingSide, LngLat } from '@transitmapper/core/model/system';
import type { ImportBBox } from '@transitmapper/core/model/import';
import { importAreaKm2, tileImportArea } from '@transitmapper/core/model/import-area';
import { useEditorStore } from '../../editor/EditorProvider';
import { useDocumentView } from '../../editor/document-view-controls';
import { beginBackgroundOsmImport } from '../../import/background-osm-import';
import { searchPlaces } from '../../network/search-places';
import { setActiveId } from '../../storage/localStore';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { useImportProgress } from '../UiProvider';
import { LocationPickerMap, type LocationPickerMapHandle } from './LocationPickerMap';
import { drivingSideForCountry } from './driving-side-for-country';

const METRO_FALLBACK_ZOOM = 11;
const MAX_IMPORT_AREA_KM2 = 5000;

interface PickerCamera {
  center: LngLat;
  zoom: number;
  bounds: ImportBBox;
}

function importAreaError(bounds: ImportBBox): string | null {
  const areaKm2 = importAreaKm2(bounds);
  if (areaKm2 === 0) return 'The visible map area is invalid — adjust the map and try again.';
  return areaKm2 > MAX_IMPORT_AREA_KM2
    ? 'Zoom in until the visible area is 5,000 km² or smaller.'
    : null;
}

interface NewSystemLocationDialogProps {
  onClose: () => void;
  /** `create` activates exactly one new document before import starts;
   * `importIntoActive` keeps the current document as the batch owner. */
  mode: 'create' | 'importIntoActive';
}

export function NewSystemLocationDialog({ onClose, mode }: NewSystemLocationDialogProps) {
  const store = useEditorStore();
  const { setImportProgress, importProgress } = useImportProgress();
  const { setViewMode } = useDocumentView();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [picked, setPicked] = useState<{ center: LngLat; drivingSide?: DrivingSide } | null>(null);
  const [camera, setCamera] = useState<PickerCamera | null>(null);
  const mapHandle = useRef<LocationPickerMapHandle>(null);
  const searchAbort = useRef<AbortController | null>(null);
  // Confirmation waits for the most recent fit/fly animation before reading
  // the authoritative visible rectangle and persisted editor camera.
  const settled = useRef<Promise<void>>(Promise.resolve());
  const started = useRef(false);
  useEffect(
    () => () => {
      searchAbort.current?.abort(new DOMException('Dialog closed.', 'AbortError'));
    },
    [],
  );

  const areaKm2 = camera ? importAreaKm2(camera.bounds) : 0;
  const estimatedTiles = useMemo(
    () => (camera ? tileImportArea(camera.bounds).length : 0),
    [camera],
  );
  const areaTooLarge = areaKm2 > MAX_IMPORT_AREA_KM2;

  const runSearch = async (event: FormEvent) => {
    event.preventDefault();
    searchAbort.current?.abort(new DOMException('Superseded by a newer search.', 'AbortError'));
    if (query.trim().length === 0) return;
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    setSearchError('');
    setResults([]);
    try {
      setResults(await searchPlaces(query, { signal: controller.signal }));
    } catch (error) {
      if (!controller.signal.aborted) {
        setSearchError(error instanceof Error ? error.message : 'Place search failed.');
      }
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  };

  const choosePlace = (place: PlaceResult) => {
    setPicked({
      center: place.center,
      drivingSide: drivingSideForCountry(place.countryCode),
    });
    setResults([]);
    setQuery(place.label);
    settled.current = place.boundingBox
      ? (mapHandle.current?.fitBounds(place.boundingBox) ?? Promise.resolve())
      : (mapHandle.current?.flyTo(place.center, METRO_FALLBACK_ZOOM) ?? Promise.resolve());
  };

  const pickOnMap = (center: LngLat) => {
    setPicked((previous) => ({ center, drivingSide: previous?.drivingSide }));
  };

  const finishLandingState = () => {
    store.commands.tools.setTool('select');
    setViewMode('infrastructure');
  };

  const confirm = async () => {
    if (!picked || areaTooLarge || importProgress?.state === 'loading' || started.current) return;
    started.current = true;
    await settled.current;
    const chosenCamera = mapHandle.current?.getCamera() ?? camera;
    if (!chosenCamera) {
      started.current = false;
      setSearchError('Map is not ready yet — try again.');
      return;
    }
    const areaError = importAreaError(chosenCamera.bounds);
    if (areaError) {
      started.current = false;
      setCamera(chosenCamera);
      setSearchError(areaError);
      return;
    }
    const drivingSide: DrivingSide =
      picked.drivingSide ??
      (mode === 'importIntoActive' ? store.getState().system.drivingSide : 'right');
    let targetSystemId: string;
    if (mode === 'create') {
      const system = createEmptySystem();
      system.viewport = { center: chosenCamera.center, zoom: chosenCamera.zoom };
      system.drivingSide = drivingSide;
      targetSystemId = system.id;
      setActiveId(system.id);
      store.commands.document.setSystem(system, { readOnly: false });
    } else {
      targetSystemId = store.getState().system.id;
      store.commands.document.setViewport({ center: chosenCamera.center, zoom: chosenCamera.zoom });
      if (picked.drivingSide) store.commands.network.setDrivingSide(picked.drivingSide);
    }
    finishLandingState();
    onClose();
    beginBackgroundOsmImport({
      store,
      setImportProgress,
      targetSystemId,
      bounds: chosenCamera.bounds,
      categories: ['road', 'bike'],
      drivingSide,
    });
  };

  const skip = () => {
    if (started.current) return;
    started.current = true;
    if (mode === 'create') {
      const system = createEmptySystem();
      const chosenCamera = mapHandle.current?.getCamera() ?? camera;
      if (chosenCamera) system.viewport = { center: chosenCamera.center, zoom: chosenCamera.zoom };
      if (picked?.drivingSide) system.drivingSide = picked.drivingSide;
      setActiveId(system.id);
      store.commands.document.setSystem(system, { readOnly: false });
      finishLandingState();
    }
    onClose();
  };

  return (
    <Modal
      title="Start a new system"
      description="Frame the metro area you want to build. Streets import in the background after you enter the editor."
      onClose={onClose}
      className="new-system-modal"
      footer={
        <div className="new-system-footer">
          <button type="button" className="ghost-btn" onClick={skip}>
            Continue with a blank canvas
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!picked || !camera || areaTooLarge || importProgress?.state === 'loading'}
            onClick={() => void confirm()}
          >
            <Icon name="download" size={18} /> Use this metro area
          </button>
        </div>
      }
    >
      <p className="panel-hint">
        Search once, then pan or zoom the map until the visible rectangle covers the whole area you
        want. Every supported street and cycleway in that rectangle will be imported.
      </p>
      <form className="new-system-search" onSubmit={(event) => void runSearch(event)}>
        <input
          className="new-system-search-input"
          type="search"
          value={query}
          placeholder="Search for a city or metro area…"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search for a place"
        />
        <button
          type="submit"
          className="ghost-btn"
          disabled={searching || query.trim().length === 0}
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
        {results.length > 0 && (
          <ul className="new-system-results">
            {results.map((result) => (
              <li key={`${result.center[0]},${result.center[1]}`}>
                <button type="button" onClick={() => choosePlace(result)}>
                  {result.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>
      <div className="new-system-map-wrap">
        <LocationPickerMap handleRef={mapHandle} onPick={pickOnMap} onCameraChange={setCamera} />
      </div>
      {camera && (
        <p className={areaTooLarge ? 'error-text' : 'panel-hint'} style={{ marginTop: 8 }}>
          {Math.round(areaKm2).toLocaleString()} km² · about {estimatedTiles.toLocaleString()} tiles
          {areaTooLarge ? ' — Zoom in until the area is 5,000 km² or smaller.' : ''}
        </p>
      )}
      {searchError && (
        <p className="error-text" style={{ marginTop: 8 }}>
          {searchError}
        </p>
      )}
    </Modal>
  );
}
