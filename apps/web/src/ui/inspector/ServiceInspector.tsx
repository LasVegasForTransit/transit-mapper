import { lazy, Suspense, useMemo, useState } from 'react';
import { useEditor, useEditorCommands } from '../../editor/EditorProvider';
import { MODE_ORDER, MODES, modesForWayType } from '@transitmapper/core/model/catalog';
import {
  pathLengthMeters,
  patternPath,
  patternLegs,
  patternRunPath,
  patternHasCouplet,
  patternHasSplit,
  primaryAnchor,
} from '@transitmapper/core/model/geo';
import { formatDistance } from '@transitmapper/core/model/units';
import type { RunDirection, Pattern, Service, Stop, Way } from '@transitmapper/core/model/system';
import {
  activeSchedule,
  dayScopeAt,
  formatSimClock,
  minutesOfDay,
} from '@transitmapper/core/sim/clock';
import { patternStops, serviceStats } from '@transitmapper/core/sim/serviceStats';
import { servicePattern } from '@transitmapper/core/model/line-service';
import { InspectorTabs, type InspectorTab } from '../InspectorTabs';
import { Panel } from '../Panel';
import { blurOnEnter } from '../formUtils';
import { Icon } from '../Icon';
import { useSim } from '../SimProvider';
import { useSimTime } from '../useSimTime';
import { useUnitPreference } from '../../services/userPreferences';
import {
  GEOMETRY_OPTIONS,
  GradeChips,
  EmptyInspector,
  formatMinutes,
  ServicesOnWay,
  Stat,
} from './shared';
import { ServiceLoadPresentation } from './service-load-presentation';
import { ServiceInspectorHeading } from './service-inspector-heading';
import { ServiceScheduleFields } from './service-schedule-fields';

// Opened only via the "Edit full schedule" link, never on initial render —
// same lazy-loading rationale as the app-level dialogs in App.tsx.
const ScheduleDialog = lazy(() =>
  import('../ScheduleDialog').then((m) => ({ default: m.ScheduleDialog })),
);
const VehicleKindsDialog = lazy(() =>
  import('../VehicleKindsDialog').then((m) => ({ default: m.VehicleKindsDialog })),
);

/** User-facing route vocabulary is normative in
 * docs/product/reference/editor-interactions.md. Keep these strings together
 * so a copy regression cannot quietly turn model names into interface terms. */
export const ROUTE_INSPECTOR_COPY = {
  pathShape: 'Path shape',
  moveService:
    'Moves this Service beneath another public Line without changing its mode, path, or schedule.',
  adoptTitle:
    'Re-route this Service onto nearby infrastructure and remove its redundant sketch geometry',
  adoptRefusal:
    "No adoptable infrastructure was found near this Service's endpoints. Build or import its path first.",
  adoptHelp: 'Fits this Service path to nearby infrastructure; anchored stops move with it.',
  pathHelp:
    'Drag a control point or endpoint to reshape · click the path to add a control point · Ctrl/⌘-drag an endpoint to extend it · Alt/Option-drag to erase a section · Ctrl/⌘-click a control point to split the path there',
} as const;

export function segmentCountLabel(count: number): string {
  return `${count} segment${count === 1 ? '' : 's'}`;
}

/** One direction's stops, in the order a rider on that trip reaches them.
 *  Resolves the path to project against — cheap here, since only the selected
 *  service is ever inspected. */
function stopsOnPattern(
  ways: Way[],
  stops: Stop[],
  pattern: Pattern,
  run: RunDirection = 'outbound',
): Stop[] {
  const path = patternRunPath(ways, pattern, run);
  if (path.length < 2) return [];
  return patternStops(stops, pattern, path, pathLengthMeters(path), run).map((s) => s.stop);
}

export interface ServiceInspectorProps {
  id: string;
}

export function ServiceInspector({ id }: ServiceInspectorProps) {
  const unitSystem = useUnitPreference();
  const service = useEditor((s) => s.system.services.find((candidate) => candidate.id === id));
  const lines = useEditor((s) => s.system.lines);
  const ways = useEditor((s) => s.system.ways);
  const stops = useEditor((s) => s.system.stops);
  const selectedStopId = useEditor((s) =>
    s.selection?.kind === 'service' && s.selection.id === id ? s.selection.stopId : undefined,
  );
  const vehicleKinds = useEditor((s) => s.system.vehicleKinds);
  const {
    services: {
      setServiceName,
      setServiceMode,
      setServiceFrequency,
      setServiceSpan,
      setServiceSchedule,
      setServiceVehicleKind,
      setVehicleKinds,
      deleteService,
      moveServiceToLine,
      setStopSkipped,
      makePatternTwoWay,
      trimPatternTo,
      splitServiceAt,
    },
    ways: { setWayGeometry, setWayGrade },
    selection: { selectAndFocus, setActivePattern },
    routing: { adoptExistingInfrastructure },
  } = useEditorCommands();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [vehicleKindsOpen, setVehicleKindsOpen] = useState(false);
  const [tab, setTab] = useState<string>('line');
  if (!service) return <EmptyInspector />;
  const singlePattern = servicePattern(service);
  const line = lines.find((candidate) => candidate.serviceIds.includes(service.id));
  const selectedStop = stops.find((stop) => stop.id === selectedStopId);
  const serviceLabel =
    service.name?.trim() ||
    (line?.serviceIds.length === 1
      ? line.name
      : `Service ${Math.max(1, (line?.serviceIds.indexOf(service.id) ?? 0) + 1)}`);
  const singleWay =
    patternLegs(singlePattern).length === 1
      ? ways.find((w) => w.id === patternLegs(singlePattern)[0].wayId)
      : undefined;
  // Measured along what the line actually rides, not by summing whole way
  // lengths: a way the pattern couldn't resolve contributes nothing, and once
  // a pattern can cover part of a way the two numbers stop agreeing.
  const length = pathLengthMeters(patternPath(ways, singlePattern));
  const patternStops = [singlePattern].map((p) => ({
    pattern: p,
    // Ride order from core's patternStops — the same derivation the simulation
    // dwells on, so the panel's "calls at" list and the stops a vehicle
    // actually makes cannot disagree. This used to be a second implementation
    // here, and it disagreed about extents: it filtered on way id alone, so a
    // stop past where the line terminates stayed in the list. A branch
    // lists only stops on its own ways; reconstructing "which trunk stops feed
    // this branch" needs graph traversal through junctions, out of scope for
    // this display.
    stops: stopsOnPattern(ways, stops, p, 'outbound'),
    // Only worth showing separately when the two directions are different
    // ground. A line that comes back the way it went would just list the same
    // stops backwards, which tells a planner nothing they can act on.
    returnStops: patternHasSplit(p) ? stopsOnPattern(ways, stops, p, 'inbound') : [],
    skippedInbound: new Set(p.skippedStops?.inbound ?? []),
  }));
  const totalStops = new Set(patternStops.flatMap(({ stops }) => stops.map((st) => st.id))).size;
  // A mode may span several way types (e.g. tram: dedicated track or street-running
  // road) — offer every mode compatible with the way this service currently rides.
  const modeOptions = singleWay
    ? modesForWayType(singleWay.typeId)
    : MODE_ORDER.map((m) => MODES[m]);

  const tabs: InspectorTab[] = [
    { id: 'line', label: 'Service' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'route', label: 'Path' },
  ];

  return (
    <Panel slot="right" aria-label="Selection details">
      <ServiceInspectorHeading
        color={line?.color}
        name={service.name}
        lineName={line?.name}
        namePlaceholder={line?.serviceIds.length === 1 ? line.name : 'Service name'}
        selectedStopName={selectedStop ? selectedStop.name || 'Unnamed stop' : undefined}
        modeLabel={MODES[service.modeId].label}
        distanceLabel={formatDistance(length, unitSystem)}
        totalStops={totalStops}
        readOnly={false}
        onNameChange={(name) => setServiceName(id, name)}
        onNameKeyDown={blurOnEnter}
      />

      <InspectorTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'line' && (
        <div className="insp-section" role="tabpanel">
          <label className="field-label">Mode</label>
          <div className="chip-row" role="group" aria-label="Mode">
            {modeOptions.map((m) => (
              <button
                key={m.id}
                className={`chip ${service.modeId === m.id ? 'active' : ''}`}
                aria-pressed={service.modeId === m.id}
                onClick={() => setServiceMode(id, m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          <label className="field-label" htmlFor="vehicle-kind-select">
            Vehicle
          </label>
          <select
            id="vehicle-kind-select"
            className="opt-select"
            style={{ width: '100%', marginBottom: 4 }}
            value={service.vehicleKindId ?? ''}
            onChange={(e) => setServiceVehicleKind(id, e.target.value || undefined)}
          >
            <option value="">Default {MODES[service.modeId].label}</option>
            {vehicleKinds
              .filter((k) => k.modeId === service.modeId)
              .map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="link-btn"
            style={{ display: 'block', marginBottom: 12 }}
            onClick={() => setVehicleKindsOpen(true)}
          >
            Manage vehicle kinds…
          </button>

          <div className="stats">
            <Stat label="Length" value={formatDistance(length, unitSystem)} />
            <Stat label="Stops" value={String(totalStops)} />
          </div>

          {singleWay && (
            <ServicesOnWay wayId={singleWay.id} activeServiceId={id} readOnly={false} />
          )}
        </div>
      )}

      {tab === 'schedule' && (
        <div className="insp-section" role="tabpanel">
          {renderScheduleSection()}
        </div>
      )}

      {tab === 'route' && (
        <div className="insp-section" role="tabpanel">
          {renderRouteSection()}
        </div>
      )}

      {scheduleOpen && (
        <Suspense fallback={null}>
          <ScheduleDialog
            serviceName={serviceLabel}
            schedule={service.schedule}
            frequencyMinutes={service.frequencyMinutes}
            spanStart={service.spanStart}
            spanEnd={service.spanEnd}
            readOnly={false}
            onSave={(periods) => setServiceSchedule(id, periods)}
            onClose={() => setScheduleOpen(false)}
          />
        </Suspense>
      )}

      {vehicleKindsOpen && (
        <Suspense fallback={null}>
          <VehicleKindsDialog
            modeId={service.modeId}
            vehicleKinds={vehicleKinds}
            readOnly={false}
            onSave={setVehicleKinds}
            onClose={() => setVehicleKindsOpen(false)}
          />
        </Suspense>
      )}

      <div className="insp-footer">
        <button className="danger-btn" onClick={() => deleteService(id)}>
          <Icon name="trash" size={18} />{' '}
          {line?.serviceIds.length === 1 ? 'Delete service and line' : 'Delete service'}
        </button>
      </div>
    </Panel>
  );

  function renderScheduleSection() {
    if (!service) return null;
    return (
      <>
        <ServiceLoad service={service} />
        <ServiceScheduleFields
          idPrefix={`service-${id}-schedule`}
          frequencyMinutes={service.frequencyMinutes}
          spanStart={service.spanStart}
          spanEnd={service.spanEnd}
          schedule={service.schedule}
          readOnly={false}
          onFrequencyChange={(frequencyMinutes) => setServiceFrequency(id, frequencyMinutes)}
          onSpanChange={(spanStart, spanEnd) => setServiceSpan(id, spanStart, spanEnd)}
          onOpenFullSchedule={() => setScheduleOpen(true)}
        />
      </>
    );
  }

  function renderRouteSection() {
    if (!service) return null;
    const moveTargets = lines.filter((candidate) => candidate.id !== line?.id);
    return (
      <>
        <button
          type="button"
          className="ghost-btn"
          style={{ width: '100%', justifyContent: 'center', marginBottom: 4 }}
          title={ROUTE_INSPECTOR_COPY.adoptTitle}
          onClick={() => {
            const n = adoptExistingInfrastructure(id);
            if (n === 0) window.alert(ROUTE_INSPECTOR_COPY.adoptRefusal);
          }}
        >
          Adopt existing infrastructure
        </button>
        <p className="insp-sub" style={{ marginBottom: 12 }}>
          {ROUTE_INSPECTOR_COPY.adoptHelp}
        </p>
        {singleWay && (
          <>
            <label className="field-label">{ROUTE_INSPECTOR_COPY.pathShape}</label>
            <p className="insp-sub">{ROUTE_INSPECTOR_COPY.pathHelp}</p>
            <div className="chip-row" role="group" aria-label={ROUTE_INSPECTOR_COPY.pathShape}>
              {GEOMETRY_OPTIONS.map(([g, label]) => (
                <button
                  key={g}
                  className={`chip ${singleWay.geometry === g ? 'active' : ''}`}
                  aria-pressed={singleWay.geometry === g}
                  disabled={g === 'freeform' && singleWay.geometry !== 'freeform'}
                  onClick={() => setWayGeometry(singleWay.id, g)}
                >
                  {label}
                </button>
              ))}
            </div>
            <GradeChips
              value={singleWay.grade}
              disabled={false}
              onChange={(g) => setWayGrade(singleWay.id, g)}
            />
          </>
        )}

        <label className="field-label">Service path</label>
        <p className="insp-sub">
          This is the one path operated by this service. Add another service when the public line
          has a branch, express pattern, or temporary shuttle.
        </p>
        <ul className="pattern-list">
          {[singlePattern].map((p) => {
            const pWay = ways.find((w) => w.id === patternLegs(p)[0]?.wayId);
            return (
              <li key={p.id} className="pattern-row">
                <button
                  type="button"
                  className="pattern-open"
                  disabled={!pWay}
                  onClick={() => setActivePattern(p.id)}
                >
                  <span className="dot ring" />
                  <span className="pattern-name">{serviceLabel}</span>
                  <span className="pattern-meta">
                    {formatDistance(pathLengthMeters(patternPath(ways, p)), unitSystem)} ·{' '}
                    {segmentCountLabel(patternLegs(p).length)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {patternHasCouplet(singlePattern) ? (
          <>
            <p className="insp-sub">
              This Service runs two one-way paths. Its outward and return trips use different
              streets.
            </p>
            <button
              type="button"
              className="ghost-btn"
              style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
              onClick={() => makePatternTwoWay(id, singlePattern.id)}
            >
              Make it run both ways on one street
            </button>
          </>
        ) : null}
        {moveTargets.length > 0 && (
          <>
            <label className="field-label" htmlFor="move-to-line-select">
              Move to another Line
            </label>
            <p className="insp-sub">{ROUTE_INSPECTOR_COPY.moveService}</p>
            <select
              id="move-to-line-select"
              className="opt-select"
              style={{ width: '100%', marginBottom: 12 }}
              defaultValue=""
              onChange={(e) => {
                const targetId = e.target.value;
                if (targetId) {
                  moveServiceToLine(id, targetId);
                  e.target.value = '';
                }
              }}
            >
              <option value="" disabled>
                Choose a Line…
              </option>
              {moveTargets.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name || 'Unnamed line'}
                </option>
              ))}
            </select>
          </>
        )}

        {patternStops.map(({ pattern, stops, returnStops, skippedInbound }) =>
          stops.length > 0 ? (
            <div key={pattern.id}>
              <label className="field-label">Stop sequence</label>
              {stops.length > 1 && (
                <p className="insp-sub">
                  A stop is a place this Service can be cut. Ending it at a stop shortens the
                  Service; the street it runs on is not touched.
                </p>
              )}
              <ol className="stop-list">
                {stops.map((st, j) => (
                  <li key={st.id} className="stop-row">
                    <button
                      type="button"
                      className="stop-item"
                      onClick={() => selectAndFocus({ kind: 'stop', id: st.id })}
                    >
                      <span className="stop-index">{j + 1}</span>
                      <span className="stop-name">{st.name || 'Unnamed stop'}</span>
                    </button>
                    {stops.length > 1 && (
                      <span className="stop-actions">
                        {/* Only where both directions ride the same stretch.
                            On a couplet they ride different streets, so a stop
                            already belongs to one direction and skipping it in
                            "the other" would mean nothing. */}
                        {patternHasSplit(pattern) ? null : (
                          <button
                            type="button"
                            className="ghost-btn stop-action"
                            title={
                              skippedInbound.has(st.id)
                                ? `Call at ${st.name || 'this stop'} on the return trip again`
                                : `Skip ${st.name || 'this stop'} on the return trip only`
                            }
                            onClick={() =>
                              setStopSkipped(
                                id,
                                pattern.id,
                                'inbound',
                                st.id,
                                !skippedInbound.has(st.id),
                              )
                            }
                          >
                            {skippedInbound.has(st.id) ? 'Call returning' : 'Skip returning'}
                          </button>
                        )}
                        {j > 0 && (
                          <button
                            type="button"
                            className="ghost-btn stop-action"
                            title={`Cut this Service back so it starts at ${st.name || 'this stop'}`}
                            onClick={() =>
                              trimPatternTo(
                                id,
                                pattern.id,
                                primaryAnchor(st)!.wayId,
                                primaryAnchor(st)!.t,
                                'start',
                              )
                            }
                          >
                            Start here
                          </button>
                        )}
                        {j < stops.length - 1 && (
                          <button
                            type="button"
                            className="ghost-btn stop-action"
                            title={`Cut this Service back so it ends at ${st.name || 'this stop'}`}
                            onClick={() =>
                              trimPatternTo(
                                id,
                                pattern.id,
                                primaryAnchor(st)!.wayId,
                                primaryAnchor(st)!.t,
                                'end',
                              )
                            }
                          >
                            End here
                          </button>
                        )}
                        {j > 0 && j < stops.length - 1 && (
                          <button
                            type="button"
                            className="ghost-btn stop-action"
                            title={`Cut this Service in two here — both halves keep running on the same infrastructure`}
                            onClick={() =>
                              splitServiceAt(
                                id,
                                pattern.id,
                                primaryAnchor(st)!.wayId,
                                primaryAnchor(st)!.t,
                              )
                            }
                          >
                            Split
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
              {returnStops.length > 0 && (
                <>
                  <label className="field-label">Return trip</label>
                  <p className="insp-sub">
                    This Service&rsquo;s two directions run different streets, so the return trip
                    calls at its own stops in its own order.
                  </p>
                  <ol className="stop-list">
                    {returnStops.map((st) => (
                      <li key={st.id} className="stop-row">
                        <button
                          type="button"
                          className="stop-open"
                          onClick={() => selectAndFocus({ kind: 'stop', id: st.id })}
                        >
                          <span className="dot ring" />
                          <span className="stop-name">{st.name || 'Unnamed stop'}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          ) : null,
        )}
      </>
    );
  }
}

interface ServiceLoadProps {
  service: Service;
}

/**
 * What this Service is doing right now, and what running it costs.
 *
 * The schedule fields below say what a Service is *configured* to do. This says
 * what that amounts to — and, crucially, shows the chain between them. Stops
 * and dwell lengthen the round trip; the round trip and the headway decide how
 * many vehicles it takes. All three used to be computed on every animation
 * frame and thrown away, so adding a stop silently added a train and
 * nothing in the editor said so.
 *
 * Everything here comes from core/sim, the same functions the map resolves
 * against, so these numbers cannot drift from what's moving on screen.
 */
function ServiceLoad({ service }: ServiceLoadProps) {
  const simMs = useSimTime();
  const { pinnedPeriod } = useSim();
  // Narrow selectors, matching the rest of this file — `system` is a fresh
  // reference on every mutation, including drag frames of an unrelated way.
  const ways = useEditor((s) => s.system.ways);
  const stops = useEditor((s) => s.system.stops);
  const vehicleKinds = useEditor((s) => s.system.vehicleKinds);

  const active = activeSchedule(service, minutesOfDay(simMs), dayScopeAt(simMs), pinnedPeriod);
  const stats = useMemo(
    () => serviceStats(ways, stops, vehicleKinds, service, active?.headwayMinutes),
    [ways, stops, vehicleKinds, service, active?.headwayMinutes],
  );
  const when = pinnedPeriod ? `“${pinnedPeriod}”` : formatSimClock(simMs);

  if (!stats)
    return (
      <p className="panel-hint">
        Draw this Service over some infrastructure to see what running it takes.
      </p>
    );

  const roundTrip = formatMinutes(stats.roundTripMs / 60_000);
  const stopCount = stats.path.stops.length;
  const dwell = stats.path.dwellMs / 60_000;

  return (
    <ServiceLoadPresentation
      active={active}
      roundTrip={roundTrip}
      fleet={stats.fleet}
      when={when}
      showPeriodLabel={!pinnedPeriod}
      stops={stopCount}
      dwellMinutes={dwell}
      layoverMinutes={stats.layoverMs / 60_000}
    />
  );
}
