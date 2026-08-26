import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type {
  MapDefinition,
  MapFeatureDetails,
  MapViewStore,
  SelectionController,
} from '@transitmapper/map/state';
import type { MapFeatureReferenceV1 } from '@transitmapper/views';
import { MapWorkspace } from '@transitmapper/workspace';
import { DOCUMENT_MAP_DEFINITION } from '@transitmapper/renderer/presentation';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Popover } from '../ui/Popover';
import { FeatureDetails } from './feature-details';

export type ViewerStatus = 'loading' | 'ready' | 'error';

interface ViewerMapRenderOptions {
  system: TransitSystem;
  viewStore: MapViewStore;
  selection: SelectionController;
  onError: (error: unknown) => void;
}

export type ViewerMapRenderer = (options: ViewerMapRenderOptions) => ReactNode;
export type ViewerFeatureDetailsResolver = (
  system: TransitSystem,
  reference: MapFeatureReferenceV1,
) => Promise<MapFeatureDetails | null>;

const resolveDocumentFeatureDetails: ViewerFeatureDetailsResolver = async (system, reference) => {
  const { documentMapFeatureDetails } = await import('./document-feature-details');
  return documentMapFeatureDetails({ status: 'ready', system }, reference);
};

export interface ViewerWorkspaceProps {
  status: ViewerStatus;
  system: TransitSystem | null;
  title?: string;
  viewStore: MapViewStore;
  selection: SelectionController;
  mapFailed: boolean;
  renderMap: ViewerMapRenderer;
  onMapError: (error: unknown) => void;
  onFork: (system: TransitSystem) => void;
  onCopyLink: () => void;
  resolveFeatureDetails?: ViewerFeatureDetailsResolver;
}

function useViewSnapshot(store: MapViewStore) {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );
}

function useSelectedFeatureDetails(
  system: TransitSystem | null,
  selection: SelectionController,
  resolveFeatureDetails: ViewerFeatureDetailsResolver,
): MapFeatureDetails | null {
  const reference = useSyncExternalStore(
    (listener) => selection.subscribe(listener),
    () => selection.getSnapshot(),
    () => selection.getSnapshot(),
  );
  const [details, setDetails] = useState<MapFeatureDetails | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    if (system === null || reference === undefined) return;
    void resolveFeatureDetails(system, reference).then((resolved) => {
      if (cancelled) return;
      setDetails(resolved);
      if (resolved === null) selection.select(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [reference, resolveFeatureDetails, selection, system]);

  return details;
}

interface RepresentationControlsProps {
  readonly store: MapViewStore;
  readonly compact?: boolean;
}

function RepresentationControls({ store, compact = false }: RepresentationControlsProps) {
  const state = useViewSnapshot(store);
  if (compact) {
    return (
      <select
        className="viewer-representation-select"
        aria-label="View"
        value={state.representationId}
        onChange={(event) => store.setRepresentationId(event.target.value)}
      >
        {DOCUMENT_MAP_DEFINITION.representations.map((representation) => (
          <option key={representation.id} value={representation.id}>
            {representation.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="segmented zen-collapse-cluster" role="group" aria-label="View">
      {DOCUMENT_MAP_DEFINITION.representations.map((representation) => (
        <button
          key={representation.id}
          type="button"
          className={`seg ${state.representationId === representation.id ? 'active' : ''}`}
          aria-pressed={state.representationId === representation.id}
          onClick={() => store.setRepresentationId(representation.id)}
        >
          {representation.label}
        </button>
      ))}
    </div>
  );
}

function toggleMultiValue(store: MapViewStore, filterId: string, optionId: string): void {
  const selected = stringValues(store.getSnapshot().filters[filterId]);
  store.setFilter(
    filterId,
    selected.includes(optionId)
      ? selected.filter((candidate) => candidate !== optionId)
      : [...selected, optionId],
  );
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
    ? value
    : [];
}

interface ViewerLayersProps {
  readonly store: MapViewStore;
  readonly definition: MapDefinition;
}

function ViewerLayers({ store, definition }: ViewerLayersProps) {
  const state = useViewSnapshot(store);
  return (
    <Popover trigger={<IconButton icon="layers" label="Layers" />}>
      <div className="lp-popover" role="group" aria-label="Layer visibility">
        {definition.filters.map((filter) => (
          <div className="lp-col" key={filter.id}>
            <span className="panel-section-label">{filter.label}</span>
            {filter.kind === 'toggle' ? (
              <label className="lp-row">
                <input
                  type="checkbox"
                  checked={state.filters[filter.id] === true}
                  onChange={() => store.setFilter(filter.id, state.filters[filter.id] !== true)}
                />
                Show
              </label>
            ) : (
              filter.options.map((option) => (
                <label className="lp-row" key={option.id}>
                  <input
                    type="checkbox"
                    checked={stringValues(state.filters[filter.id]).includes(option.id)}
                    onChange={() => toggleMultiValue(store, filter.id, option.id)}
                  />
                  {option.label}
                </label>
              ))
            )}
          </div>
        ))}
      </div>
    </Popover>
  );
}

interface ViewerPanelProps {
  readonly system: TransitSystem | null;
  readonly status: ViewerStatus;
  readonly representationLabel: string;
}

function ViewerPanel({ system, status, representationLabel }: ViewerPanelProps) {
  if (status !== 'ready' || system === null) {
    return <div className="viewer-panel-placeholder" aria-hidden="true" />;
  }
  return (
    <div className="viewer-panel">
      <p className="panel-section-label">{representationLabel}</p>
      <dl className="viewer-counts">
        <div>
          <dt>Lines</dt>
          <dd>{system.lines.length}</dd>
        </div>
        <div>
          <dt>Stops</dt>
          <dd>{system.stops.length}</dd>
        </div>
        <div>
          <dt>Stations</dt>
          <dd>{system.stations.length}</dd>
        </div>
      </dl>
    </div>
  );
}

interface ViewerActionsProps {
  readonly system: TransitSystem | null;
  readonly viewStore: MapViewStore;
  readonly onFork: (system: TransitSystem) => void;
  readonly onCopyLink: () => void;
}

function ViewerActions({ system, viewStore, onFork, onCopyLink }: ViewerActionsProps) {
  if (system === null) return null;
  return (
    <>
      <ViewerLayers store={viewStore} definition={DOCUMENT_MAP_DEFINITION} />
      <button type="button" className="btn" data-viewer-action="copy" onClick={onCopyLink}>
        <Icon name="share" size={18} /> <span className="btn-label">Copy link to this view</span>
      </button>
      <button
        type="button"
        className="primary-btn"
        data-viewer-action="fork"
        onClick={() => onFork(system)}
      >
        <Icon name="copy" size={18} /> <span className="btn-label">Fork &amp; edit</span>
      </button>
    </>
  );
}

export function ViewerWorkspace({
  status,
  system,
  title,
  viewStore,
  selection,
  mapFailed,
  renderMap,
  onMapError,
  onFork,
  onCopyLink,
  resolveFeatureDetails = resolveDocumentFeatureDetails,
}: ViewerWorkspaceProps) {
  const [chromeHidden, setChromeHidden] = useState(false);
  const view = useViewSnapshot(viewStore);
  const details = useSelectedFeatureDetails(system, selection, resolveFeatureDetails);
  const selectedRepresentation = DOCUMENT_MAP_DEFINITION.representations.find(
    (candidate) => candidate.id === view.representationId,
  );
  const representationLabel =
    selectedRepresentation?.label ?? DOCUMENT_MAP_DEFINITION.representations[0].label;
  const notice =
    status === 'loading'
      ? 'Opening shared map…'
      : status === 'error'
        ? 'This shared system could not be opened.'
        : mapFailed
          ? 'The transit map could not be drawn.'
          : null;
  const mapSurface =
    system === null ? (
      <div className="workspace-map-surface" role="region" aria-label="Map" />
    ) : (
      renderMap({ system, viewStore, selection, onError: onMapError })
    );
  return (
    <MapWorkspace
      mapSurface={mapSurface}
      slots={{
        brand: <span className="viewer-brand">{title ?? system?.name ?? 'TransitMapper'}</span>,
        primaryActions: (
          <ViewerActions
            system={system}
            viewStore={viewStore}
            onFork={onFork}
            onCopyLink={onCopyLink}
          />
        ),
        representationControls: <RepresentationControls store={viewStore} />,
        compactRepresentationControls: <RepresentationControls store={viewStore} compact />,
        simulationControls: null,
        compactSimulationControls: null,
        mainPanel: (
          <ViewerPanel system={system} status={status} representationLabel={representationLabel} />
        ),
        supplementalPanel: details ? (
          <FeatureDetails details={details} onClose={() => selection.select(undefined)} />
        ) : null,
        toolDock: null,
        applicationNotices: notice
          ? { content: <div className="viewer-notice">{notice}</div>, placement: 'panel-aligned' }
          : undefined,
      }}
      state={{
        representationLabel,
        hasSupplementalContent: details !== null,
        initialSupplementalDetent: details === null ? null : 'half',
        chromeHidden,
        contentStatus: status,
      }}
      actions={{
        onToggleInterface: () => setChromeHidden((hidden) => !hidden),
        onDismissSupplemental: () => selection.select(undefined),
      }}
    />
  );
}
