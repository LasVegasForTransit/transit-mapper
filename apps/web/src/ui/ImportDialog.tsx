import { useMemo, useState } from 'react';
import {
  IMPORT_CATEGORY_LABELS,
  IMPORT_CATEGORY_ORDER,
  type ImportBBox,
  type ImportCategory,
} from '@transitmapper/core/model/import';
import {
  importAreaKm2,
  normalizeImportBounds,
  tileImportArea,
} from '@transitmapper/core/model/import-area';
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

interface CurrentImportArea {
  bounds: ImportBBox | null;
  invalid: boolean;
}

function currentImportArea(): CurrentImportArea {
  const bounds = getMap()?.getBounds();
  if (!bounds) return { bounds: null, invalid: false };
  const normalized = normalizeImportBounds({
    west: bounds.getWest(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    north: bounds.getNorth(),
  });
  return { bounds: normalized ?? null, invalid: normalized === undefined };
}

interface ImportAreaStatusProps {
  areaKm2: number;
  estimatedTiles: number;
  hasBounds: boolean;
  invalid: boolean;
  tooLarge: boolean;
}

function ImportAreaStatus(props: ImportAreaStatusProps) {
  const { areaKm2, estimatedTiles, hasBounds, invalid, tooLarge } = props;
  if (invalid) {
    return (
      <p className="error-text" style={{ marginTop: 8 }}>
        Zoom in until the visible area is smaller than one world copy.
      </p>
    );
  }
  if (!hasBounds) return null;
  return (
    <p className={tooLarge ? 'error-text' : 'panel-hint'} style={{ marginTop: 8 }}>
      {Math.round(areaKm2).toLocaleString()} km² · about {estimatedTiles.toLocaleString()} tiles
      {tooLarge ? ' — Close this dialog and zoom in below 5,000 km².' : ''}
    </p>
  );
}

function withCategoryToggled(previous: Set<ImportCategory>, category: ImportCategory) {
  const next = new Set(previous);
  if (next.has(category)) next.delete(category);
  else next.add(category);
  return next;
}

export function ImportDialog({ onClose }: ImportDialogProps) {
  const store = useEditorStore();
  const { importProgress, setImportProgress } = useImportProgress();
  const [categories, setCategories] = useState<Set<ImportCategory>>(
    () => new Set(['road', 'bike']),
  );
  const { bounds, invalid: invalidArea } = currentImportArea();
  const areaKm2 = bounds ? importAreaKm2(bounds) : 0;
  const estimatedTiles = useMemo(() => (bounds ? tileImportArea(bounds).length : 0), [bounds]);
  const tooLarge = areaKm2 > MAX_IMPORT_AREA_KM2;
  const blocked =
    !bounds ||
    invalidArea ||
    tooLarge ||
    categories.size === 0 ||
    importProgress?.state === 'loading';

  const toggle = (category: ImportCategory) =>
    setCategories((previous) => withCategoryToggled(previous, category));

  const run = () => {
    if (blocked) return;
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
          disabled={blocked}
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
      <ImportAreaStatus
        areaKm2={areaKm2}
        estimatedTiles={estimatedTiles}
        hasBounds={Boolean(bounds)}
        invalid={invalidArea}
        tooLarge={tooLarge}
      />
    </Modal>
  );
}
