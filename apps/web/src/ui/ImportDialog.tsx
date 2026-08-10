import { useMemo, useState } from 'react';
import {
  IMPORT_CATEGORY_LABELS,
  IMPORT_CATEGORY_ORDER,
  type ImportBBox,
  type ImportCategory,
} from '@transitmapper/core/model/import';
import { importAreaKm2, tileImportArea } from '@transitmapper/core/model/import-area';
import { useEditorStore } from '../editor/EditorProvider';
import { beginBackgroundOsmImport } from '../import/background-osm-import';
import { getMap } from '../map/mapRef';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { useImportProgress } from './UiProvider';

const MAX_IMPORT_AREA_KM2 = 5000;

interface ImportDialogProps {
  onClose: () => void;
}

function currentBounds(): ImportBBox | null {
  const bounds = getMap()?.getBounds();
  return bounds
    ? {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      }
    : null;
}

export function ImportDialog({ onClose }: ImportDialogProps) {
  const store = useEditorStore();
  const { importProgress, setImportProgress } = useImportProgress();
  const [categories, setCategories] = useState<Set<ImportCategory>>(
    () => new Set(['road', 'bike']),
  );
  const bounds = currentBounds();
  const areaKm2 = bounds ? importAreaKm2(bounds) : 0;
  const estimatedTiles = useMemo(() => (bounds ? tileImportArea(bounds).length : 0), [bounds]);
  const tooLarge = areaKm2 > MAX_IMPORT_AREA_KM2;

  const toggle = (category: ImportCategory) =>
    setCategories((previous) => {
      const next = new Set(previous);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const run = () => {
    if (!bounds || categories.size === 0 || tooLarge || importProgress?.state === 'loading') return;
    const state = store.getState();
    beginBackgroundOsmImport({
      store,
      setImportProgress,
      targetSystemId: state.system.id,
      bounds,
      categories: [...categories],
      drivingSide: state.system.drivingSide,
    });
    onClose();
  };

  return (
    <Modal
      title="Import real streets"
      description="Import OpenStreetMap infrastructure in the current map view while you keep editing."
      onClose={onClose}
      footer={
        <button
          className="primary-btn"
          style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}
          disabled={
            !bounds || tooLarge || categories.size === 0 || importProgress?.state === 'loading'
          }
          onClick={run}
        >
          <Icon name="download" size={18} />{' '}
          {importProgress?.state === 'loading' ? 'Import already running' : 'Import in background'}
        </button>
      }
    >
      <p className="panel-hint">
        The visible rectangle is the import boundary. Completed batches remain if you cancel or an
        OpenStreetMap mirror becomes unavailable.
      </p>
      <div
        className="chip-row"
        role="group"
        aria-label="Categories to import"
        style={{ marginTop: 8 }}
      >
        {IMPORT_CATEGORY_ORDER.map((category) => (
          <button
            key={category}
            className={`chip ${categories.has(category) ? 'active' : ''}`}
            aria-pressed={categories.has(category)}
            onClick={() => toggle(category)}
          >
            {IMPORT_CATEGORY_LABELS[category]}
          </button>
        ))}
      </div>
      {bounds && (
        <p className={tooLarge ? 'error-text' : 'panel-hint'} style={{ marginTop: 8 }}>
          {Math.round(areaKm2).toLocaleString()} km² · about {estimatedTiles.toLocaleString()} tiles
          {tooLarge ? ' — Close this dialog and zoom in below 5,000 km².' : ''}
        </p>
      )}
    </Modal>
  );
}
