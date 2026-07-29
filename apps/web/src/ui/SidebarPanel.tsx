import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { FACILITY_TYPES, MODE_ORDER, MODES, WAY_TYPES } from '@transitmapper/core/model/catalog';
import type { EditorState, Selection } from '../editor/store';
import { useEditor } from '../editor/EditorProvider';
import { Icon } from './Icon';
import {
  limitSidebarItems,
  limitSidebarPatterns,
  lineStopsForService,
  networkCorridors,
  sidebarTabStopKey,
} from './sidebarOutline';
import { useListboxKeyboardNav } from './useListboxKeyboardNav';
import { useView } from './ViewProvider';

const LIST_CAP = 150;

interface SidebarSectionProps {
  title: string;
  count?: number;
  detail?: string;
  defaultOpen?: boolean;
  children?: ReactNode;
}

function SidebarSection({
  title,
  count,
  detail,
  defaultOpen = true,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="sidebar-section">
      <button
        type="button"
        className="sidebar-section-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon
          name="chevronDown"
          size={15}
          style={{ transform: open ? undefined : 'rotate(-90deg)' }}
        />
        <span>{title}</span>
        <span className="sidebar-section-meta">{detail ?? count}</span>
      </button>
      {open && children && <div className="sidebar-section-body">{children}</div>}
    </section>
  );
}

interface ShowMoreProps {
  hiddenCount: number;
  onClick: () => void;
}

function ShowMore({ hiddenCount, onClick }: ShowMoreProps) {
  if (hiddenCount <= 0) return null;
  return (
    <button type="button" className="link-btn sidebar-show-more" onClick={onClick}>
      Show {hiddenCount} more…
    </button>
  );
}

function rowKey(kind: NonNullable<Selection>['kind'], id: string): string {
  return `${kind}:${id}`;
}

export function SidebarPanel() {
  const system = useEditor((state) => state.system);
  const selection = useEditor((state) => state.selection);
  const multiSelection = useEditor((state) => state.multiSelection);
  const selectAndFocus = useEditor((state) => state.selectAndFocus);
  const extendSelection = useEditor((state) => state.extendSelection);
  const addMultiSelection = useEditor((state) => state.addMultiSelection);
  const { viewMode } = useView();
  const { containerRef, onKeyDown } = useListboxKeyboardNav<HTMLDivElement>(
    '[data-sidebar-option]:not(:disabled)',
  );

  const commonProps = {
    system,
    selection,
    multiSelection,
    selectAndFocus,
    extendSelection,
    addMultiSelection,
  };

  if (viewMode === 'diagram') return <DiagramWorkspace />;

  return (
    <div
      className="panel-body sidebar-workspace"
      ref={containerRef}
      role="navigation"
      aria-label={`${viewMode === 'network' ? 'Network' : 'Infrastructure'} workspace`}
      onKeyDown={onKeyDown}
    >
      <div className="sidebar-workspace-title">
        {viewMode === 'network' ? 'Network' : 'Infrastructure'}
      </div>
      {viewMode === 'network' ? (
        <NetworkWorkspace {...commonProps} />
      ) : (
        <InfrastructureWorkspace {...commonProps} />
      )}
    </div>
  );
}

interface SharedWorkspaceProps {
  system: EditorState['system'];
  selection: Selection;
  multiSelection: EditorState['multiSelection'];
  selectAndFocus: EditorState['selectAndFocus'];
  extendSelection: EditorState['extendSelection'];
  addMultiSelection: EditorState['addMultiSelection'];
}

function NetworkWorkspace({
  system,
  selection,
  multiSelection,
  selectAndFocus,
  extendSelection,
  addMultiSelection,
}: SharedWorkspaceProps) {
  const [groupBy, setGroupBy] = useState<'lines' | 'corridors'>('lines');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const lastServiceIdRef = useRef<string | null>(null);
  const lines = system.services;
  const corridors = useMemo(
    () =>
      groupBy === 'corridors'
        ? networkCorridors({
            namedWays: system.namedWays,
            services: system.services,
            stations: system.stations,
            ways: system.ways,
          })
        : [],
    [groupBy, system.namedWays, system.services, system.stations, system.ways],
  );
  const serviceById = useMemo(
    () => new Map(system.services.map((service) => [service.id, service])),
    [system.services],
  );
  const stationById = useMemo(
    () => new Map(system.stations.map((station) => [station.id, station])),
    [system.stations],
  );
  const totalCount = groupBy === 'lines' ? lines.length : corridors.length;
  const visibleCount = Math.min(totalCount, showAll ? totalCount : LIST_CAP);
  const hiddenCount = totalCount - visibleCount;
  const visibleLines = lines.slice(0, visibleCount);
  const visibleCorridors = corridors.slice(0, visibleCount);
  const firstKey =
    groupBy === 'lines'
      ? visibleLines[0]
        ? rowKey('service', visibleLines[0].id)
        : null
      : visibleCorridors[0]?.wayIds[0]
        ? rowKey('way', visibleCorridors[0].wayIds[0])
        : null;
  const selectedKey = selection ? rowKey(selection.kind, selection.id) : null;
  const selectedIsVisible =
    selection !== null &&
    (groupBy === 'lines'
      ? selection.kind === 'service'
        ? visibleLines.some((line) => line.id === selection.id)
        : selection.kind === 'station'
          ? visibleLines.some((line) => {
              const key = `line:${line.id}`;
              if (!expandedRows.has(key)) return false;
              return limitSidebarPatterns(
                lineStopsForService(system, line.id),
                expandedRows.has(`all:${key}`),
                LIST_CAP,
              ).items.some((pattern) =>
                pattern.stops.some((stop) => stop.stationId === selection.id),
              );
            })
          : false
      : visibleCorridors.some((corridor) => {
          if (selection.kind === 'way') return corridor.wayIds.includes(selection.id);
          const key = `corridor:${corridor.id}`;
          if (!expandedRows.has(key)) return false;
          const children = [
            ...corridor.serviceIds.map((id) => ({ kind: 'service' as const, id })),
            ...corridor.stationIds.map((id) => ({ kind: 'station' as const, id })),
          ];
          return limitSidebarItems(children, expandedRows.has(`all:${key}`), LIST_CAP).items.some(
            (item) => item.kind === selection.kind && item.id === selection.id,
          );
        }));
  const tabStopKey = sidebarTabStopKey(firstKey, selectedKey, selectedIsVisible);
  const tabIndexFor = (kind: NonNullable<Selection>['kind'], id: string) =>
    rowKey(kind, id) === tabStopKey ? 0 : -1;
  const toggleRow = (key: string) =>
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectService = (event: ReactMouseEvent, serviceId: string) => {
    if (event.shiftKey && lastServiceIdRef.current) {
      const from = lines.findIndex((line) => line.id === lastServiceIdRef.current);
      const to = lines.findIndex((line) => line.id === serviceId);
      if (from >= 0 && to >= 0) {
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        addMultiSelection(
          lines.slice(lo, hi + 1).map((line) => ({ kind: 'service', id: line.id })),
        );
        return;
      }
    }
    lastServiceIdRef.current = serviceId;
    if (event.ctrlKey || event.metaKey) extendSelection({ kind: 'service', id: serviceId });
    else selectAndFocus({ kind: 'service', id: serviceId });
  };

  return (
    <>
      <div className="sidebar-grouping" role="group" aria-label="Group network by">
        <span>Group by</span>
        <div className="sidebar-segmented">
          <button
            type="button"
            aria-pressed={groupBy === 'lines'}
            onClick={() => {
              setGroupBy('lines');
              setShowAll(false);
            }}
          >
            Lines
          </button>
          <button
            type="button"
            aria-pressed={groupBy === 'corridors'}
            onClick={() => {
              setGroupBy('corridors');
              setShowAll(false);
            }}
          >
            Corridors
          </button>
        </div>
      </div>

      <SidebarSection title={groupBy === 'lines' ? 'Lines' : 'Corridors'} count={totalCount}>
        {groupBy === 'lines'
          ? visibleLines.map((line) => {
              const key = `line:${line.id}`;
              const open = expandedRows.has(key);
              const patterns = open ? lineStopsForService(system, line.id) : [];
              const limitedPatterns = limitSidebarPatterns(
                patterns,
                expandedRows.has(`all:${key}`),
                LIST_CAP,
              );
              const active =
                (selection?.kind === 'service' && selection.id === line.id) ||
                multiSelection.some((item) => item.kind === 'service' && item.id === line.id);
              return (
                <div key={line.id} className="sidebar-tree-item">
                  <div className="sidebar-tree-row">
                    <button
                      type="button"
                      className="sidebar-disclosure"
                      aria-label={open ? `Collapse ${line.name}` : `Expand ${line.name}`}
                      aria-expanded={open}
                      onClick={() => toggleRow(key)}
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
                      aria-pressed={active}
                      tabIndex={tabIndexFor('service', line.id)}
                      className={`list-row sidebar-main-row ${active ? 'active' : ''}`}
                      onClick={(event) => selectService(event, line.id)}
                    >
                      <span className="dot" style={{ background: line.color }} />
                      <span className="list-name">{line.name}</span>
                      <span className="list-tag">{MODES[line.modeId]?.label ?? line.modeId}</span>
                    </button>
                  </div>
                  {open && (
                    <div className="sidebar-tree-children">
                      {limitedPatterns.items.map((pattern) => (
                        <div key={pattern.patternId}>
                          {patterns.length > 1 && (
                            <div className="sidebar-nested-label">
                              {pattern.name || 'Unnamed branch'}
                            </div>
                          )}
                          {pattern.stops.map((stop, index) => (
                            <button
                              key={`${pattern.patternId}:${stop.stationId}`}
                              type="button"
                              data-sidebar-option
                              aria-pressed={
                                selection?.kind === 'station' && selection.id === stop.stationId
                              }
                              tabIndex={tabIndexFor('station', stop.stationId)}
                              className={`list-row sidebar-stop-row ${
                                selection?.kind === 'station' && selection.id === stop.stationId
                                  ? 'active'
                                  : ''
                              }`}
                              onClick={() =>
                                selectAndFocus({ kind: 'station', id: stop.stationId })
                              }
                            >
                              <span className="sidebar-stop-index">{index + 1}</span>
                              <span className="dot ring" />
                              <span className="list-name">{stop.name}</span>
                            </button>
                          ))}
                        </div>
                      ))}
                      <ShowMore
                        hiddenCount={limitedPatterns.hiddenCount}
                        onClick={() =>
                          setExpandedRows((current) => new Set(current).add(`all:${key}`))
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })
          : visibleCorridors.map((corridor) => {
              const key = `corridor:${corridor.id}`;
              const open = expandedRows.has(key);
              const wayId = corridor.wayIds[0];
              const active = selection?.kind === 'way' && corridor.wayIds.includes(selection.id);
              const children = [
                ...corridor.serviceIds.map((id) => ({ kind: 'service' as const, id })),
                ...corridor.stationIds.map((id) => ({ kind: 'station' as const, id })),
              ];
              const limitedChildren = limitSidebarItems(
                children,
                expandedRows.has(`all:${key}`),
                LIST_CAP,
              );
              const visibleServiceIds = limitedChildren.items
                .filter((item) => item.kind === 'service')
                .map((item) => item.id);
              const visibleStationIds = limitedChildren.items
                .filter((item) => item.kind === 'station')
                .map((item) => item.id);
              return (
                <div key={corridor.id} className="sidebar-tree-item">
                  <div className="sidebar-tree-row">
                    <button
                      type="button"
                      className="sidebar-disclosure"
                      aria-label={open ? `Collapse ${corridor.label}` : `Expand ${corridor.label}`}
                      aria-expanded={open}
                      onClick={() => toggleRow(key)}
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
                      aria-pressed={active}
                      tabIndex={tabIndexFor('way', wayId)}
                      className={`list-row sidebar-main-row ${active ? 'active' : ''}`}
                      onClick={() => selectAndFocus({ kind: 'way', id: wayId })}
                    >
                      <span className="dot ring" />
                      <span className="list-name">{corridor.label}</span>
                      <span className="list-tag">
                        {corridor.serviceIds.length}{' '}
                        {corridor.serviceIds.length === 1 ? 'line' : 'lines'}
                      </span>
                    </button>
                  </div>
                  {open && (
                    <div className="sidebar-tree-children">
                      {visibleServiceIds.length > 0 && (
                        <div className="sidebar-nested-label">Lines using this corridor</div>
                      )}
                      {visibleServiceIds.map((serviceId) => {
                        const service = serviceById.get(serviceId);
                        if (!service) return null;
                        return (
                          <button
                            key={service.id}
                            type="button"
                            data-sidebar-option
                            aria-pressed={
                              selection?.kind === 'service' && selection.id === service.id
                            }
                            tabIndex={tabIndexFor('service', service.id)}
                            className="list-row sidebar-nested-row"
                            onClick={(event) => selectService(event, service.id)}
                          >
                            <span className="dot" style={{ background: service.color }} />
                            <span className="list-name">{service.name}</span>
                          </button>
                        );
                      })}
                      {visibleStationIds.length > 0 && (
                        <div className="sidebar-nested-label">Permanent stations</div>
                      )}
                      {visibleStationIds.map((stationId) => {
                        const station = stationById.get(stationId);
                        if (!station) return null;
                        return (
                          <button
                            key={station.id}
                            type="button"
                            data-sidebar-option
                            aria-pressed={
                              selection?.kind === 'station' && selection.id === station.id
                            }
                            tabIndex={tabIndexFor('station', station.id)}
                            className="list-row sidebar-nested-row"
                            onClick={() => selectAndFocus({ kind: 'station', id: station.id })}
                          >
                            <span className="dot ring" />
                            <span className="list-name">{station.name || 'Unnamed station'}</span>
                          </button>
                        );
                      })}
                      <ShowMore
                        hiddenCount={limitedChildren.hiddenCount}
                        onClick={() =>
                          setExpandedRows((current) => new Set(current).add(`all:${key}`))
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
        <ShowMore hiddenCount={hiddenCount} onClick={() => setShowAll(true)} />
      </SidebarSection>
      <SidebarSection title="Vehicles" detail="Coming later" defaultOpen={false} />
    </>
  );
}

function InfrastructureWorkspace({ system, selection, selectAndFocus }: SharedWorkspaceProps) {
  const [expandedLists, setExpandedLists] = useState<Set<string>>(() => new Set());
  const membersOfComplexes = useMemo(
    () =>
      new Set(system.groups.filter((group) => group.footprint).flatMap((group) => group.memberIds)),
    [system.groups],
  );
  const complexes = system.groups.filter((group) => group.footprint);
  const standaloneFacilities = system.facilities.filter(
    (facility) => !membersOfComplexes.has(facility.id),
  );
  const places = [
    ...complexes.map((group) => ({ kind: 'group' as const, value: group })),
    ...standaloneFacilities.map((facility) => ({ kind: 'facility' as const, value: facility })),
  ];
  const visiblePlaces = limitSidebarItems(places, expandedLists.has('places'), LIST_CAP);
  const shown = <T,>(key: string, values: T[]) =>
    values.slice(0, expandedLists.has(key) ? undefined : LIST_CAP);
  const visibleCorridors = shown('corridors', system.namedWays);
  const visibleStations = shown('stations', system.stations);
  const firstCorridor = visibleCorridors.find((corridor) =>
    corridor.wayIds.some((id) => system.ways.some((way) => way.id === id)),
  );
  const firstWayId = firstCorridor?.wayIds.find((id) => system.ways.some((way) => way.id === id));
  const firstPlace = visiblePlaces.items[0];
  const firstKey = firstWayId
    ? rowKey('way', firstWayId)
    : visibleStations[0]
      ? rowKey('station', visibleStations[0].id)
      : firstPlace
        ? rowKey(firstPlace.kind, firstPlace.value.id)
        : null;
  const selectedKey = selection ? rowKey(selection.kind, selection.id) : null;
  const selectedIsVisible =
    selection !== null &&
    (selection.kind === 'way'
      ? visibleCorridors.some((corridor) => corridor.wayIds.includes(selection.id))
      : selection.kind === 'station'
        ? visibleStations.some((station) => station.id === selection.id)
        : visiblePlaces.items.some(
            (place) => place.kind === selection.kind && place.value.id === selection.id,
          ));
  const tabStopKey = sidebarTabStopKey(firstKey, selectedKey, selectedIsVisible);
  const tabIndexFor = (kind: NonNullable<Selection>['kind'], id: string) =>
    rowKey(kind, id) === tabStopKey ? 0 : -1;
  const expand = (key: string) => setExpandedLists((current) => new Set(current).add(key));

  return (
    <>
      <SidebarSection title="Corridors" count={system.namedWays.length}>
        {visibleCorridors.map((corridor) => {
          const wayId = corridor.wayIds.find((id) => system.ways.some((way) => way.id === id));
          if (!wayId) return null;
          const way = system.ways.find((candidate) => candidate.id === wayId);
          return (
            <button
              key={corridor.id}
              type="button"
              data-sidebar-option
              aria-pressed={selection?.kind === 'way' && corridor.wayIds.includes(selection.id)}
              tabIndex={tabIndexFor('way', wayId)}
              className={`list-row ${
                selection?.kind === 'way' && corridor.wayIds.includes(selection.id) ? 'active' : ''
              }`}
              onClick={() => selectAndFocus({ kind: 'way', id: wayId })}
            >
              <span className="dot ring" />
              <span className="list-name">{corridor.name || 'Unnamed corridor'}</span>
              {way && (
                <span className="list-tag">{WAY_TYPES[way.typeId]?.label ?? way.typeId}</span>
              )}
            </button>
          );
        })}
        <ShowMore
          hiddenCount={system.namedWays.length - shown('corridors', system.namedWays).length}
          onClick={() => expand('corridors')}
        />
      </SidebarSection>

      <SidebarSection title="Stations" count={system.stations.length}>
        {visibleStations.map((station) => (
          <button
            key={station.id}
            type="button"
            data-sidebar-option
            aria-pressed={selection?.kind === 'station' && selection.id === station.id}
            tabIndex={tabIndexFor('station', station.id)}
            className={`list-row ${
              selection?.kind === 'station' && selection.id === station.id ? 'active' : ''
            }`}
            onClick={() => selectAndFocus({ kind: 'station', id: station.id })}
          >
            <span className="dot ring" />
            <span className="list-name">{station.name || 'Unnamed station'}</span>
            {station.platforms && station.platforms.length > 0 && (
              <span className="list-tag">
                {station.platforms.length}{' '}
                {station.platforms.length === 1 ? 'platform' : 'platforms'}
              </span>
            )}
          </button>
        ))}
        <ShowMore
          hiddenCount={system.stations.length - shown('stations', system.stations).length}
          onClick={() => expand('stations')}
        />
      </SidebarSection>

      <SidebarSection
        title="Complexes and facilities"
        count={complexes.length + standaloneFacilities.length}
      >
        {visiblePlaces.items.map((place) => {
          if (place.kind === 'group') {
            const group = place.value;
            return (
              <button
                key={group.id}
                type="button"
                data-sidebar-option
                aria-pressed={selection?.kind === 'group' && selection.id === group.id}
                tabIndex={tabIndexFor('group', group.id)}
                className={`list-row ${
                  selection?.kind === 'group' && selection.id === group.id ? 'active' : ''
                }`}
                onClick={() => selectAndFocus({ kind: 'group', id: group.id })}
              >
                <span className="dot ring" />
                <span className="list-name">{group.name || 'Facility complex'}</span>
                <span className="list-tag">{group.memberIds.length}</span>
              </button>
            );
          }
          const facility = place.value;
          return (
            <button
              key={facility.id}
              type="button"
              data-sidebar-option
              aria-pressed={selection?.kind === 'facility' && selection.id === facility.id}
              tabIndex={tabIndexFor('facility', facility.id)}
              className={`list-row ${
                selection?.kind === 'facility' && selection.id === facility.id ? 'active' : ''
              }`}
              onClick={() => selectAndFocus({ kind: 'facility', id: facility.id })}
            >
              <span className="dot ring" />
              <span className="list-name">
                {facility.name || FACILITY_TYPES[facility.typeId]?.label || facility.typeId}
              </span>
            </button>
          );
        })}
        <ShowMore hiddenCount={visiblePlaces.hiddenCount} onClick={() => expand('places')} />
      </SidebarSection>
    </>
  );
}

function DiagramWorkspace() {
  const { visibleModes, toggleMode, showAllModes, showLandmarks, toggleLandmarks } = useView();
  return (
    <div className="panel-body sidebar-workspace" aria-label="Diagram presentation">
      <div className="sidebar-workspace-title">Diagram</div>
      <SidebarSection title="Services" count={visibleModes.size}>
        <div className="sidebar-section-actions">
          <button type="button" className="link-btn" onClick={showAllModes}>
            Show all
          </button>
        </div>
        {MODE_ORDER.map((modeId) => (
          <label key={modeId} className="sidebar-check-row">
            <input
              type="checkbox"
              checked={visibleModes.has(modeId)}
              onChange={() => toggleMode(modeId)}
            />
            <span>{MODES[modeId].label}</span>
          </label>
        ))}
      </SidebarSection>
      <SidebarSection title="Reference">
        <label className="sidebar-check-row">
          <input type="checkbox" checked={showLandmarks} onChange={toggleLandmarks} />
          <span>Landmarks</span>
        </label>
      </SidebarSection>
    </div>
  );
}
