import {
  Component,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { FACILITY_TYPES, MODES } from '@transitmapper/core/model/catalog';
import type { Facility, Station } from '@transitmapper/core/model/system';
import type { EditorCommands, EditorState, Selection } from '../editor/store';
import { useEditor, useEditorCommands } from '../editor/EditorProvider';
import { Icon } from './Icon';
import {
  infrastructureOutlineProjection,
  limitSidebarItems,
  networkLineRows,
  servicesForSidebarLine,
  sidebarTabStopKey,
  type SidebarLineRow,
  type SidebarInfrastructureItem,
  type SidebarService,
  type InfrastructureOutlineProjection,
  type InfrastructureSection,
  type LimitedSidebarItems,
} from './sidebarOutline';
import { useListboxKeyboardNav } from './useListboxKeyboardNav';
import { useView, type ViewMode } from './ViewProvider';

const LIST_CAP = 150;

interface OutlinePresentationState {
  query: string;
  expanded: Set<string>;
  expandedLists: Set<string>;
}

function emptyOutlinePresentationState(): OutlinePresentationState {
  return { query: '', expanded: new Set(), expandedLists: new Set() };
}

function presentationActions(update: OutlineProps['updatePresentation']) {
  return {
    toggle: (key: string) =>
      update((current) => {
        const next = new Set(current.expanded);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { ...current, expanded: next };
      }),
    showAll: (key: string) =>
      update((current) => ({
        ...current,
        expandedLists: new Set(current.expandedLists).add(key),
      })),
  };
}

export class SidebarSectionBoundary extends Component<
  { label: string; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `${this.props.label} sidebar section failed to render:`,
      error,
      info.componentStack,
    );
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="sidebar-empty" role="alert">
        <p>{this.props.label} couldn’t be shown.</p>
        <button type="button" className="link-btn" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}

function SidebarSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="sidebar-section">
      <button
        type="button"
        className="sidebar-section-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon
          name="chevronDown"
          size={15}
          style={{ transform: open ? undefined : 'rotate(-90deg)' }}
        />
        <span>{title}</span>
        <span className="sidebar-section-meta">{count}</span>
      </button>
      {open && (
        <div className="sidebar-section-body">
          <SidebarSectionBoundary label={title}>{children}</SidebarSectionBoundary>
        </div>
      )}
    </section>
  );
}

function ShowMore({ hiddenCount, onClick }: { hiddenCount: number; onClick: () => void }) {
  if (hiddenCount <= 0) return null;
  return (
    <button type="button" className="link-btn sidebar-show-more" onClick={onClick}>
      Show {hiddenCount} more…
    </button>
  );
}

function SidebarEmpty({ children }: { children: ReactNode }) {
  return <p className="sidebar-empty">{children}</p>;
}

function rowKey(kind: NonNullable<Selection>['kind'], id: string): string {
  return `${kind}:${id}`;
}

function stopRowKey(serviceId: string, stationId: string): string {
  return rowKey('service', `stop:${serviceId}:${stationId}`);
}

function sidebarTabIndexFor(tabStopKey: string | null) {
  let assigned = false;
  return (kind: NonNullable<Selection>['kind'], id: string): 0 | -1 => {
    if (assigned || rowKey(kind, id) !== tabStopKey) return -1;
    assigned = true;
    return 0;
  };
}

const OUTLINE_TITLE: Record<ViewMode, string> = {
  network: 'Network outline',
  infrastructure: 'Infrastructure outline',
  diagram: 'Diagram outline',
};

export function SidebarPanel() {
  const system = useEditor((state) => state.system);
  const selection = useEditor((state) => state.selection);
  const { selectAndFocus, setOutlineHover } = useEditorCommands().selection;
  const { viewMode } = useView();
  const [presentationByView, setPresentationByView] = useState<
    Record<ViewMode, OutlinePresentationState>
  >(() => ({
    network: emptyOutlinePresentationState(),
    infrastructure: emptyOutlinePresentationState(),
    diagram: emptyOutlinePresentationState(),
  }));
  const presentation = presentationByView[viewMode];
  const updatePresentation = (
    update: (current: OutlinePresentationState) => OutlinePresentationState,
  ) =>
    setPresentationByView((current) => ({
      ...current,
      [viewMode]: update(current[viewMode]),
    }));
  const { containerRef, onKeyDown } = useListboxKeyboardNav('[data-sidebar-option]:not(:disabled)');
  const scrollPositions = useRef<Record<ViewMode, number>>({
    network: 0,
    infrastructure: 0,
    diagram: 0,
  });
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const positions = scrollPositions.current;
    container.scrollTop = positions[viewMode];
    return () => {
      positions[viewMode] = container.scrollTop;
    };
  }, [containerRef, viewMode]);
  useEffect(() => () => setOutlineHover(null), [setOutlineHover, viewMode]);
  const props = {
    system,
    selection,
    selectAndFocus,
    setOutlineHover,
    presentation,
    updatePresentation,
  };

  return (
    <div
      className="panel-body sidebar-workspace"
      ref={containerRef}
      role="region"
      aria-label={OUTLINE_TITLE[viewMode]}
      onKeyDown={onKeyDown}
    >
      <div className="sidebar-outline-heading">
        <input
          type="search"
          className="sidebar-search"
          aria-label={`Search ${OUTLINE_TITLE[viewMode].toLowerCase()}`}
          placeholder="Search"
          value={presentation.query}
          onChange={(event) =>
            updatePresentation((current) => ({ ...current, query: event.target.value }))
          }
        />
      </div>
      {viewMode === 'infrastructure' ? (
        <SidebarSectionBoundary key="infrastructure" label="Infrastructure outline">
          <InfrastructureOutline {...props} />
        </SidebarSectionBoundary>
      ) : (
        <SidebarSectionBoundary key={viewMode} label={OUTLINE_TITLE[viewMode]}>
          <NetworkOutline {...props} />
        </SidebarSectionBoundary>
      )}
    </div>
  );
}

interface OutlineProps {
  system: EditorState['system'];
  selection: Selection;
  selectAndFocus: EditorCommands['selection']['selectAndFocus'];
  setOutlineHover: EditorCommands['selection']['setOutlineHover'];
  presentation: OutlinePresentationState;
  updatePresentation: (
    update: (current: OutlinePresentationState) => OutlinePresentationState,
  ) => void;
}

function serviceKeysForLine(
  row: SidebarLineRow & { displayServices: SidebarService[] },
  normalized: string,
  expanded: Set<string>,
): string[] {
  const lineOpen = normalized.length > 0 || expanded.has(`line:${row.line.id}`);
  if (!lineOpen) return [];
  if (!normalized && row.services.length === 1) {
    return row.services[0].stops.map((stop) =>
      stopRowKey(row.services[0].serviceId, stop.stationId),
    );
  }
  return row.displayServices.flatMap((service) => {
    const serviceKey = rowKey('service', service.serviceId);
    const serviceOpen = normalized.length > 0 || expanded.has(`service:${service.serviceId}`);
    const stopKeys = serviceOpen
      ? service.stops.map((stop) => stopRowKey(service.serviceId, stop.stationId))
      : [];
    return [serviceKey, ...stopKeys];
  });
}

function networkVisibleKeys(
  rows: (SidebarLineRow & { displayServices: SidebarService[] })[],
  stations: Station[],
  normalized: string,
  expanded: Set<string>,
): Set<string> {
  return new Set([
    ...rows.flatMap((row) => [
      rowKey('line', row.line.id),
      ...serviceKeysForLine(row, normalized, expanded),
    ]),
    ...stations.map((station) => rowKey('station', station.id)),
  ]);
}

function NetworkOutline({
  system,
  selection,
  selectAndFocus,
  setOutlineHover,
  presentation,
  updatePresentation,
}: OutlineProps) {
  const normalized = presentation.query.trim().toLocaleLowerCase();
  const lineRows = useMemo(() => networkLineRows(system, normalized), [normalized, system]);
  const stations = system.stations.filter(
    (station) =>
      !normalized || (station.name ?? 'Unnamed station').toLocaleLowerCase().includes(normalized),
  );
  let searchBudget = LIST_CAP;
  const boundedSearchRows = lineRows.flatMap((row) => {
    if (!normalized || searchBudget <= 0) return [];
    searchBudget -= 1;
    const displayServices = row.searchServices.flatMap((service) => {
      if (searchBudget <= 0) return [];
      searchBudget -= 1;
      const stops = service.stops.slice(0, searchBudget);
      searchBudget -= stops.length;
      return [{ ...service, stops }];
    });
    return [{ ...row, displayServices }];
  });
  const visibleLines = normalized
    ? { items: boundedSearchRows, hiddenCount: 0 }
    : {
        ...limitSidebarItems(lineRows, presentation.expandedLists.has('lines'), LIST_CAP),
        items: limitSidebarItems(
          lineRows,
          presentation.expandedLists.has('lines'),
          LIST_CAP,
        ).items.map((row) => ({ ...row, displayServices: row.services })),
      };
  const visibleStations = normalized
    ? { items: stations.slice(0, searchBudget), hiddenCount: 0 }
    : limitSidebarItems(stations, presentation.expandedLists.has('stations'), LIST_CAP);
  const firstKey = visibleLines.items[0]
    ? rowKey('line', visibleLines.items[0].line.id)
    : visibleStations.items[0]
      ? rowKey('station', visibleStations.items[0].id)
      : null;
  const selectedKey =
    selection?.kind === 'service' && selection.stopId
      ? stopRowKey(selection.id, selection.stopId)
      : selection
        ? rowKey(selection.kind, selection.id)
        : null;
  const visibleKeys = networkVisibleKeys(
    visibleLines.items,
    visibleStations.items,
    normalized,
    presentation.expanded,
  );
  const tabIndexFor = sidebarTabIndexFor(
    sidebarTabStopKey(firstKey, selectedKey, selectedKey !== null && visibleKeys.has(selectedKey)),
  );
  const { toggle, showAll } = presentationActions(updatePresentation);

  return (
    <>
      <SidebarSection
        title="Lines"
        count={lineRows.length}
        open={normalized.length > 0 || !presentation.expanded.has('collapsed:lines')}
        onToggle={() => toggle('collapsed:lines')}
      >
        {visibleLines.items.length === 0 && (
          <SidebarEmpty>{normalized ? 'No matching lines.' : 'Draw a line to begin.'}</SidebarEmpty>
        )}
        {visibleLines.items.map((row) => (
          <NetworkLineTreeItem
            key={row.line.id}
            row={row}
            normalized={normalized}
            expanded={presentation.expanded}
            selection={selection}
            selectAndFocus={selectAndFocus}
            setOutlineHover={setOutlineHover}
            toggle={toggle}
            tabIndexFor={tabIndexFor}
          />
        ))}
        {!normalized && (
          <ShowMore hiddenCount={visibleLines.hiddenCount} onClick={() => showAll('lines')} />
        )}
      </SidebarSection>

      <SidebarSection
        title="Stations"
        count={stations.length}
        open={normalized.length > 0 || !presentation.expanded.has('collapsed:stations')}
        onToggle={() => toggle('collapsed:stations')}
      >
        {visibleStations.items.length === 0 && (
          <SidebarEmpty>
            {normalized ? 'No matching stations.' : 'Add a station to mark a shared place.'}
          </SidebarEmpty>
        )}
        {visibleStations.items.map((station) => (
          <button
            key={station.id}
            type="button"
            data-sidebar-option
            aria-pressed={selection?.kind === 'station' && selection.id === station.id}
            tabIndex={tabIndexFor('station', station.id)}
            className={`list-row ${selection?.kind === 'station' && selection.id === station.id ? 'active' : ''}`}
            onClick={() => selectAndFocus({ kind: 'station', id: station.id })}
            onMouseEnter={() => setOutlineHover({ kind: 'station', id: station.id })}
            onMouseLeave={() => setOutlineHover(null)}
          >
            <span className="dot ring" />
            <span className="list-name">{station.name || 'Unnamed station'}</span>
          </button>
        ))}
        {!normalized && (
          <ShowMore hiddenCount={visibleStations.hiddenCount} onClick={() => showAll('stations')} />
        )}
      </SidebarSection>
    </>
  );
}

interface NetworkTreeProps {
  normalized: string;
  expanded: Set<string>;
  selection: Selection;
  selectAndFocus: EditorCommands['selection']['selectAndFocus'];
  setOutlineHover: EditorCommands['selection']['setOutlineHover'];
  toggle: (key: string) => void;
  tabIndexFor: ReturnType<typeof sidebarTabIndexFor>;
}

function ServiceTreeItem({
  service,
  lineName,
  normalized,
  expanded,
  selection,
  selectAndFocus,
  setOutlineHover,
  toggle,
  tabIndexFor,
}: NetworkTreeProps & { service: SidebarService; lineName: string }) {
  const serviceKey = `service:${service.serviceId}`;
  const open = normalized.length > 0 || expanded.has(serviceKey);
  const selected = selection?.kind === 'service' && selection.id === service.serviceId;
  return (
    <div>
      <div className="sidebar-tree-row sidebar-service-row">
        <button
          type="button"
          className="sidebar-disclosure"
          aria-label={open ? `Collapse ${service.name}` : `Expand ${service.name}`}
          aria-expanded={open}
          onClick={() => toggle(serviceKey)}
        >
          <Icon
            name="chevronDown"
            size={13}
            style={{ transform: open ? undefined : 'rotate(-90deg)' }}
          />
        </button>
        <button
          type="button"
          data-sidebar-option
          aria-pressed={selected}
          tabIndex={tabIndexFor('service', service.serviceId)}
          className={`list-row sidebar-nested-row ${selected ? 'active' : ''}`}
          onClick={() => selectAndFocus({ kind: 'service', id: service.serviceId })}
          onMouseEnter={() => setOutlineHover({ kind: 'service', id: service.serviceId })}
          onMouseLeave={() => setOutlineHover(null)}
        >
          <span className="list-name">{service.name}</span>
          <span className="list-tag">{MODES[service.modeId].label}</span>
        </button>
      </div>
      {open && (
        <StopRows
          serviceId={service.serviceId}
          contextLabel={`${lineName}, ${service.name}`}
          stops={service.stops}
          selection={selection}
          selectAndFocus={selectAndFocus}
          setOutlineHover={setOutlineHover}
          tabIndexFor={tabIndexFor}
        />
      )}
    </div>
  );
}

function LineTreeChildren({
  row,
  lineName,
  ...props
}: NetworkTreeProps & {
  row: SidebarLineRow & { displayServices: SidebarService[] };
  lineName: string;
}) {
  if (props.normalized || row.services.length > 1) {
    return row.displayServices.map((service) => (
      <ServiceTreeItem key={service.serviceId} service={service} lineName={lineName} {...props} />
    ));
  }
  const service = row.services.at(0);
  return service ? (
    <StopRows
      serviceId={service.serviceId}
      contextLabel={`${lineName}, ${MODES[service.modeId].label} Service`}
      stops={service.stops}
      selection={props.selection}
      selectAndFocus={props.selectAndFocus}
      setOutlineHover={props.setOutlineHover}
      tabIndexFor={props.tabIndexFor}
    />
  ) : null;
}

function NetworkLineTreeItem({
  row,
  normalized,
  expanded,
  selection,
  selectAndFocus,
  setOutlineHover,
  toggle,
  tabIndexFor,
}: NetworkTreeProps & { row: SidebarLineRow & { displayServices: SidebarService[] } }) {
  const { line, services } = row;
  const lineKey = `line:${line.id}`;
  const open = normalized.length > 0 || expanded.has(lineKey);
  const selected = selection?.kind === 'line' && selection.id === line.id;
  const modes = [...new Set(services.map((service) => MODES[service.modeId].label))];
  const modeSummary = modes.length > 1 ? `${modes.length} modes` : (modes.at(0) ?? '');
  const lineName = line.name || 'Unnamed line';
  return (
    <div className="sidebar-tree-item">
      <div className="sidebar-tree-row">
        <button
          type="button"
          className="sidebar-disclosure"
          aria-label={open ? `Collapse ${line.name}` : `Expand ${line.name}`}
          aria-expanded={open}
          onClick={() => toggle(lineKey)}
        >
          <Icon
            name="chevronDown"
            size={14}
            style={{ transform: open ? undefined : 'rotate(-90deg)' }}
          />
        </button>
        <button
          type="button"
          data-sidebar-option
          aria-pressed={selected}
          tabIndex={tabIndexFor('line', line.id)}
          className={`list-row sidebar-main-row ${selected ? 'active' : ''}`}
          onClick={() => selectAndFocus({ kind: 'line', id: line.id })}
          onMouseEnter={() => setOutlineHover({ kind: 'line', id: line.id })}
          onMouseLeave={() => setOutlineHover(null)}
        >
          <span className="dot" style={{ background: line.color }} />
          <span className="list-name">{lineName}</span>
          <span className="list-tag">{modeSummary}</span>
        </button>
      </div>
      {open && (
        <div className="sidebar-tree-children">
          <LineTreeChildren
            row={row}
            lineName={lineName}
            normalized={normalized}
            expanded={expanded}
            selection={selection}
            selectAndFocus={selectAndFocus}
            setOutlineHover={setOutlineHover}
            toggle={toggle}
            tabIndexFor={tabIndexFor}
          />
        </div>
      )}
    </div>
  );
}

function StopRows({
  serviceId,
  contextLabel,
  stops,
  selection,
  selectAndFocus,
  setOutlineHover,
  tabIndexFor,
}: {
  serviceId: string;
  contextLabel: string;
  stops: ReturnType<typeof servicesForSidebarLine>[number]['stops'];
  selection: Selection;
  selectAndFocus: EditorCommands['selection']['selectAndFocus'];
  setOutlineHover: EditorCommands['selection']['setOutlineHover'];
  tabIndexFor: ReturnType<typeof sidebarTabIndexFor>;
}) {
  return (
    <div className="sidebar-stop-list">
      {stops.map((stop, index) => (
        <button
          key={`${stop.stationId}:${index}`}
          type="button"
          data-sidebar-option
          aria-label={`Stop ${index + 1}, ${stop.name}, ${contextLabel}`}
          aria-pressed={
            selection?.kind === 'service' &&
            selection.id === serviceId &&
            selection.stopId === stop.stationId
          }
          tabIndex={tabIndexFor('service', `stop:${serviceId}:${stop.stationId}`)}
          className={`list-row sidebar-stop-row ${
            selection?.kind === 'service' &&
            selection.id === serviceId &&
            selection.stopId === stop.stationId
              ? 'active'
              : ''
          }`}
          onClick={() => selectAndFocus({ kind: 'service', id: serviceId, stopId: stop.stationId })}
          onMouseEnter={() =>
            setOutlineHover({ kind: 'service', id: serviceId, stopId: stop.stationId })
          }
          onMouseLeave={() => setOutlineHover(null)}
        >
          <span className="sidebar-stop-index">{index + 1}</span>
          <span className="dot ring" />
          <span className="list-name">{stop.name}</span>
        </button>
      ))}
    </div>
  );
}

interface VisibleInfrastructureSection extends InfrastructureSection {
  limited: LimitedSidebarItems<SidebarInfrastructureItem>;
}

function visibleInfrastructureRows(
  projection: InfrastructureOutlineProjection,
  normalized: string,
  expandedLists: Set<string>,
) {
  const { sections, stations, facilities } = projection;
  let searchBudget = LIST_CAP;
  const visibleSections = sections
    .map((section): VisibleInfrastructureSection => {
      const limited = normalized
        ? { items: section.items.slice(0, searchBudget), hiddenCount: 0 }
        : limitSidebarItems(section.items, expandedLists.has(`ways:${section.title}`), LIST_CAP);
      if (normalized) searchBudget -= limited.items.length;
      return { ...section, limited };
    })
    .filter((section) => !normalized || section.limited.items.length > 0);
  const visibleStations = normalized
    ? { items: stations.slice(0, searchBudget), hiddenCount: 0 }
    : limitSidebarItems(stations, expandedLists.has('stations'), LIST_CAP);
  if (normalized) searchBudget -= visibleStations.items.length;
  const visibleFacilities = normalized
    ? { items: facilities.slice(0, searchBudget), hiddenCount: 0 }
    : limitSidebarItems(facilities, expandedLists.has('facilities'), LIST_CAP);
  return { visibleSections, visibleStations, visibleFacilities };
}

function infrastructureSelectionKeys(
  sections: VisibleInfrastructureSection[],
  stations: Station[],
  facilities: Facility[],
  selection: Selection,
) {
  const firstInfrastructure = sections.at(0)?.limited.items.at(0);
  const firstKey = firstInfrastructure
    ? rowKey('way', firstInfrastructure.primaryWayId)
    : stations.at(0)
      ? rowKey('station', stations[0].id)
      : facilities.at(0)
        ? rowKey('facility', facilities[0].id)
        : null;
  const selectedInfrastructure =
    selection?.kind === 'way'
      ? sections
          .flatMap((section) => section.limited.items)
          .find((item) => item.wayIds.includes(selection.id))
      : undefined;
  const selectedKey = selectedInfrastructure
    ? rowKey('way', selectedInfrastructure.primaryWayId)
    : selection
      ? rowKey(selection.kind, selection.id)
      : null;
  const visibleKeys = new Set([
    ...sections.flatMap((section) =>
      section.limited.items.map((item) => rowKey('way', item.primaryWayId)),
    ),
    ...stations.map((station) => rowKey('station', station.id)),
    ...facilities.map((facility) => rowKey('facility', facility.id)),
  ]);
  return { firstKey, selectedKey, visibleKeys };
}

interface InfrastructureSectionProps {
  normalized: string;
  selection: Selection;
  selectAndFocus: EditorCommands['selection']['selectAndFocus'];
  setOutlineHover: EditorCommands['selection']['setOutlineHover'];
  expanded: Set<string>;
  toggle: (key: string) => void;
  showAll: (key: string) => void;
  tabIndexFor: ReturnType<typeof sidebarTabIndexFor>;
}

function InfrastructureWaySections({
  sections,
  normalized,
  selection,
  selectAndFocus,
  setOutlineHover,
  expanded,
  toggle,
  showAll,
  tabIndexFor,
}: InfrastructureSectionProps & { sections: VisibleInfrastructureSection[] }) {
  return sections.map((section) => (
    <SidebarSection
      key={section.title}
      title={section.title}
      count={section.items.length}
      open={normalized.length > 0 || !expanded.has(`collapsed:${section.title}`)}
      onToggle={() => toggle(`collapsed:${section.title}`)}
    >
      {section.limited.items.map((item) => {
        const active = selection?.kind === 'way' && item.wayIds.includes(selection.id);
        return (
          <button
            key={item.identityId}
            type="button"
            data-sidebar-option
            aria-label={`${item.name}, ${item.typeLabel}${item.wayIds.length > 1 ? `, ${item.wayIds.length} segments` : ''}`}
            aria-pressed={active}
            tabIndex={tabIndexFor('way', item.primaryWayId)}
            className={`list-row ${active ? 'active' : ''}`}
            onClick={() =>
              selectAndFocus({ kind: 'way', id: item.primaryWayId, relatedIds: item.wayIds })
            }
            onMouseEnter={() =>
              setOutlineHover({ kind: 'way', id: item.primaryWayId, relatedIds: item.wayIds })
            }
            onMouseLeave={() => setOutlineHover(null)}
          >
            <span className="dot ring" />
            <span className="list-name">{item.name}</span>
            <span className="list-tag">{item.typeLabel}</span>
          </button>
        );
      })}
      {!normalized && (
        <ShowMore
          hiddenCount={section.limited.hiddenCount}
          onClick={() => showAll(`ways:${section.title}`)}
        />
      )}
    </SidebarSection>
  ));
}

function InfrastructureStationsSection({
  stations,
  allCount,
  ...props
}: InfrastructureSectionProps & {
  stations: LimitedSidebarItems<Station>;
  allCount: number;
}) {
  const { normalized, selection, selectAndFocus, setOutlineHover, expanded, toggle, showAll } =
    props;
  return (
    <SidebarSection
      title="Stations"
      count={allCount}
      open={normalized.length > 0 || !expanded.has('collapsed:stations')}
      onToggle={() => toggle('collapsed:stations')}
    >
      {stations.items.length === 0 && (
        <SidebarEmpty>
          {normalized && allCount > 0
            ? 'Refine your search to see more matching stations.'
            : normalized
              ? 'No matching stations.'
              : 'Add a station to its physical site.'}
        </SidebarEmpty>
      )}
      {stations.items.map((station) => (
        <button
          key={station.id}
          type="button"
          data-sidebar-option
          aria-pressed={selection?.kind === 'station' && selection.id === station.id}
          tabIndex={props.tabIndexFor('station', station.id)}
          className={`list-row ${selection?.kind === 'station' && selection.id === station.id ? 'active' : ''}`}
          onClick={() => selectAndFocus({ kind: 'station', id: station.id })}
          onMouseEnter={() => setOutlineHover({ kind: 'station', id: station.id })}
          onMouseLeave={() => setOutlineHover(null)}
        >
          <span className="dot ring" />
          <span className="list-name">{station.name || 'Unnamed station'}</span>
          {station.platforms && station.platforms.length > 0 && (
            <span className="list-tag">{station.platforms.length} platforms</span>
          )}
        </button>
      ))}
      {!normalized && (
        <ShowMore hiddenCount={stations.hiddenCount} onClick={() => showAll('stations')} />
      )}
    </SidebarSection>
  );
}

function InfrastructureFacilitiesSection({
  facilities,
  allCount,
  ...props
}: InfrastructureSectionProps & {
  facilities: LimitedSidebarItems<Facility>;
  allCount: number;
}) {
  const { normalized, selection, selectAndFocus, setOutlineHover, expanded, toggle, showAll } =
    props;
  return (
    <SidebarSection
      title="Facilities"
      count={allCount}
      open={normalized.length > 0 || !expanded.has('collapsed:facilities')}
      onToggle={() => toggle('collapsed:facilities')}
    >
      {facilities.items.length === 0 && (
        <SidebarEmpty>
          {normalized && allCount > 0
            ? 'Refine your search to see more matching facilities.'
            : normalized
              ? 'No matching facilities.'
              : 'Place a facility to add it here.'}
        </SidebarEmpty>
      )}
      {facilities.items.map((facility) => (
        <button
          key={facility.id}
          type="button"
          data-sidebar-option
          aria-pressed={selection?.kind === 'facility' && selection.id === facility.id}
          tabIndex={props.tabIndexFor('facility', facility.id)}
          className={`list-row ${selection?.kind === 'facility' && selection.id === facility.id ? 'active' : ''}`}
          onClick={() => selectAndFocus({ kind: 'facility', id: facility.id })}
          onMouseEnter={() => setOutlineHover({ kind: 'facility', id: facility.id })}
          onMouseLeave={() => setOutlineHover(null)}
        >
          <span className="dot ring" />
          <span className="list-name">
            {facility.name || FACILITY_TYPES[facility.typeId].label}
          </span>
        </button>
      ))}
      {!normalized && (
        <ShowMore hiddenCount={facilities.hiddenCount} onClick={() => showAll('facilities')} />
      )}
    </SidebarSection>
  );
}

function InfrastructureOutline({
  system,
  selection,
  selectAndFocus,
  setOutlineHover,
  presentation,
  updatePresentation,
}: OutlineProps) {
  const normalized = presentation.query.trim().toLocaleLowerCase();
  const projection = useMemo(
    () => infrastructureOutlineProjection(system, normalized),
    [normalized, system],
  );
  const { stations, facilities } = projection;
  const { visibleSections, visibleStations, visibleFacilities } = visibleInfrastructureRows(
    projection,
    normalized,
    presentation.expandedLists,
  );
  const { toggle, showAll } = presentationActions(updatePresentation);
  const { firstKey, selectedKey, visibleKeys } = infrastructureSelectionKeys(
    visibleSections,
    visibleStations.items,
    visibleFacilities.items,
    selection,
  );
  const tabIndexFor = sidebarTabIndexFor(
    sidebarTabStopKey(firstKey, selectedKey, selectedKey !== null && visibleKeys.has(selectedKey)),
  );
  const sectionProps: InfrastructureSectionProps = {
    normalized,
    selection,
    selectAndFocus,
    setOutlineHover,
    expanded: presentation.expanded,
    toggle,
    showAll,
    tabIndexFor,
  };

  return (
    <>
      <InfrastructureWaySections sections={visibleSections} {...sectionProps} />
      <InfrastructureStationsSection
        stations={visibleStations}
        allCount={stations.length}
        {...sectionProps}
      />
      <InfrastructureFacilitiesSection
        facilities={visibleFacilities}
        allCount={facilities.length}
        {...sectionProps}
      />
    </>
  );
}
