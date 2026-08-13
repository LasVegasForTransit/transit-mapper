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
import type {
  RunDirection,
  Pattern,
  ScheduleDayScope,
  Service,
  Stop,
  Way,
} from '@transitmapper/core/model/system';
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
// Opened only via the "Edit full schedule" link, never on initial render —
// same lazy-loading rationale as the app-level dialogs in App.tsx.
const ScheduleDialog = lazy(() =>
  import('../ScheduleDialog').then((m) => ({ default: m.ScheduleDialog })),
);
const VehicleKindsDialog = lazy(() =>
  import('../VehicleKindsDialog').then((m) => ({ default: m.VehicleKindsDialog })),
);

// Turnkey presets so setting up a working schedule is a click, not typing —
// matches internal-operations/service-creation.ts's defaults (a fresh
// Service's frequency/span always lands on one of these chips, never in the
// "Custom" fallback). "Custom" reveals the raw number/time inputs this
// section used to be, for anything a preset can't express.
const FREQUENCY_PRESETS = [5, 10, 15, 20, 30, 60];

interface SpanPreset {
  label: string;
  start: string;
  end: string;
}

const SPAN_PRESETS: SpanPreset[] = [
  { label: 'Daytime', start: '06:00', end: '23:00' },
  { label: 'Early–late', start: '05:00', end: '01:00' },
  { label: '24/7', start: '00:00', end: '23:59' },
];

const DAY_SCOPE_LABEL: Record<ScheduleDayScope, string> = {
  daily: 'Every day',
  weekday: 'Weekdays',
  weekend: 'Weekends',
};

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

function formatSpan(start: string, end: string): string {
  return `${start}–${end}`;
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
  const readOnly = useEditor((s) => s.readOnly);
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
  // Derived once at mount (this component remounts on service switch — see
  // its key={id} call site) from whether the CURRENT value already matches
  // a preset chip: an imported/hand-set value that doesn't hit one still
  // needs to be visible and editable, not silently unrepresented by any chip.
  const [freqCustomOpen, setFreqCustomOpen] = useState(
    () =>
      service?.frequencyMinutes !== undefined &&
      !FREQUENCY_PRESETS.includes(service.frequencyMinutes),
  );
  const [spanCustomOpen, setSpanCustomOpen] = useState(
    () =>
      (service?.spanStart !== undefined || service?.spanEnd !== undefined) &&
      !SPAN_PRESETS.some((p) => p.start === service.spanStart && p.end === service.spanEnd),
  );

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
    singlePattern && patternLegs(singlePattern).length === 1
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
  const hasFullSchedule = !!service.schedule && service.schedule.length > 0;
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
      <div className="insp-head">
        <span className="dot" style={{ background: line?.color }} />
        <input
          className="insp-name"
          aria-label="Service name"
          placeholder={line?.serviceIds.length === 1 ? line.name : 'Service name'}
          value={service.name ?? ''}
          disabled={readOnly}
          onChange={(e) => setServiceName(id, e.target.value)}
          onKeyDown={blurOnEnter}
        />
      </div>
      <div className="insp-kind">
        {line?.name ? `${line.name} · ` : ''}
        {MODES[service.modeId]?.label ?? 'Service'} · {formatDistance(length, unitSystem)} ·{' '}
        {totalStops} stop
        {totalStops === 1 ? '' : 's'}
        {selectedStop ? ` · Call at ${selectedStop.name || 'Unnamed stop'}` : ''}
      </div>

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
                disabled={readOnly}
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
            disabled={readOnly}
            value={service.vehicleKindId ?? ''}
            onChange={(e) => setServiceVehicleKind(id, e.target.value || undefined)}
          >
            <option value="">Default {MODES[service.modeId]?.label ?? 'vehicle'}</option>
            {vehicleKinds
              .filter((k) => k.modeId === service.modeId)
              .map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
          </select>
          {!readOnly && (
            <button
              type="button"
              className="link-btn"
              style={{ display: 'block', marginBottom: 12 }}
              onClick={() => setVehicleKindsOpen(true)}
            >
              Manage vehicle kinds…
            </button>
          )}

          <div className="stats">
            <Stat label="Length" value={formatDistance(length, unitSystem)} />
            <Stat label="Stops" value={String(totalStops)} />
          </div>

          {singleWay && (
            <ServicesOnWay wayId={singleWay.id} activeServiceId={id} readOnly={readOnly} />
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
            readOnly={readOnly}
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
            readOnly={readOnly}
            onSave={setVehicleKinds}
            onClose={() => setVehicleKindsOpen(false)}
          />
        </Suspense>
      )}

      {!readOnly && (
        <div className="insp-footer">
          <button className="danger-btn" onClick={() => deleteService(id)}>
            <Icon name="trash" size={18} />{' '}
            {line?.serviceIds.length === 1 ? 'Delete service and line' : 'Delete service'}
          </button>
        </div>
      )}
    </Panel>
  );

  function renderScheduleSection() {
    if (!service) return null;
    return (
      <>
        <ServiceLoad service={service} />
        {renderScheduleFields()}
      </>
    );
  }

  function renderScheduleFields() {
    if (!service) return null;
    return hasFullSchedule ? (
      <>
        <label className="field-label">Schedule</label>
        <ul className="pattern-list">
          {service.schedule!.map((p) => (
            <li key={p.id} className="pattern-row">
              <button type="button" className="pattern-open" onClick={() => setScheduleOpen(true)}>
                <span className="dot ring" />
                <span className="pattern-name">{p.label}</span>
                <span className="pattern-meta">
                  {DAY_SCOPE_LABEL[p.days]} · every {p.frequencyMinutes} min ·{' '}
                  {formatSpan(p.spanStart, p.spanEnd)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="ghost-btn"
          style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
          onClick={() => setScheduleOpen(true)}
        >
          <Icon name="clock" size={17} /> {readOnly ? 'View full schedule' : 'Edit full schedule'}
        </button>
      </>
    ) : (
      <>
        <label className="field-label" id="freq-chips-label">
          Peak headway
        </label>
        <div className="chip-row" role="group" aria-labelledby="freq-chips-label">
          {FREQUENCY_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              className={`chip ${!freqCustomOpen && service.frequencyMinutes === m ? 'active' : ''}`}
              aria-pressed={!freqCustomOpen && service.frequencyMinutes === m}
              disabled={readOnly}
              onClick={() => {
                setFreqCustomOpen(false);
                setServiceFrequency(id, m);
              }}
            >
              {m} min
            </button>
          ))}
          <button
            type="button"
            className={`chip ${freqCustomOpen ? 'active' : ''}`}
            aria-pressed={freqCustomOpen}
            disabled={readOnly}
            onClick={() => setFreqCustomOpen(true)}
          >
            Custom
          </button>
        </div>
        {freqCustomOpen && (
          <div className="freq-row">
            <input
              type="number"
              min={1}
              className="freq-input"
              aria-label="Custom peak headway in minutes"
              value={service.frequencyMinutes ?? ''}
              disabled={readOnly}
              placeholder="Not set"
              onChange={(e) =>
                setServiceFrequency(
                  id,
                  e.target.value === ''
                    ? undefined
                    : Math.max(1, Math.round(Number(e.target.value))),
                )
              }
              onKeyDown={blurOnEnter}
            />
            <span className="freq-suffix">min between vehicles, peak</span>
          </div>
        )}

        <label className="field-label" id="span-chips-label">
          Span of service
        </label>
        <div className="chip-row" role="group" aria-labelledby="span-chips-label">
          {SPAN_PRESETS.map((p) => {
            const active =
              !spanCustomOpen && service.spanStart === p.start && service.spanEnd === p.end;
            return (
              <button
                key={p.label}
                type="button"
                className={`chip ${active ? 'active' : ''}`}
                aria-pressed={active}
                disabled={readOnly}
                onClick={() => {
                  setSpanCustomOpen(false);
                  setServiceSpan(id, p.start, p.end);
                }}
              >
                {p.label}
              </button>
            );
          })}
          <button
            type="button"
            className={`chip ${spanCustomOpen ? 'active' : ''}`}
            aria-pressed={spanCustomOpen}
            disabled={readOnly}
            onClick={() => setSpanCustomOpen(true)}
          >
            Custom
          </button>
        </div>
        {spanCustomOpen && (
          <div className="freq-row">
            <input
              type="time"
              className="freq-input freq-time"
              aria-label="First departure"
              value={service.spanStart ?? ''}
              disabled={readOnly}
              onChange={(e) => setServiceSpan(id, e.target.value || undefined, service.spanEnd)}
            />
            <span className="freq-suffix">to</span>
            <input
              type="time"
              className="freq-input freq-time"
              aria-label="Last departure"
              value={service.spanEnd ?? ''}
              disabled={readOnly}
              onChange={(e) => setServiceSpan(id, service.spanStart, e.target.value || undefined)}
            />
          </div>
        )}

        {!readOnly && line && (
          <button
            type="button"
            className="link-btn"
            style={{ display: 'block', marginBottom: 12 }}
            onClick={() => setScheduleOpen(true)}
          >
            Use a full schedule instead
          </button>
        )}
      </>
    );
  }

  function renderRouteSection() {
    if (!service) return null;
    const moveTargets = lines.filter((candidate) => candidate.id !== line?.id);
    return (
      <>
        {!readOnly && (
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
          </>
        )}
        {singleWay && (
          <>
            <label className="field-label">{ROUTE_INSPECTOR_COPY.pathShape}</label>
            {!readOnly && <p className="insp-sub">{ROUTE_INSPECTOR_COPY.pathHelp}</p>}
            <div className="chip-row" role="group" aria-label={ROUTE_INSPECTOR_COPY.pathShape}>
              {GEOMETRY_OPTIONS.map(([g, label]) => (
                <button
                  key={g}
                  className={`chip ${singleWay.geometry === g ? 'active' : ''}`}
                  aria-pressed={singleWay.geometry === g}
                  disabled={readOnly || (g === 'freeform' && singleWay.geometry !== 'freeform')}
                  onClick={() => setWayGeometry(singleWay.id, g)}
                >
                  {label}
                </button>
              ))}
            </div>
            <GradeChips
              value={singleWay.grade}
              disabled={readOnly}
              onChange={(g) => setWayGrade(singleWay.id, g)}
            />
          </>
        )}

        <label className="field-label">Service path</label>
        {!readOnly && (
          <p className="insp-sub">
            This is the one path operated by this service. Add another service when the public line
            has a branch, express pattern, or temporary shuttle.
          </p>
        )}
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
        {!readOnly && (
          <>
            {singlePattern &&
              (patternHasCouplet(singlePattern) ? (
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
              ) : null)}
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
          </>
        )}

        {patternStops.map(({ pattern, stops, returnStops, skippedInbound }) =>
          stops.length > 0 ? (
            <div key={pattern.id}>
              <label className="field-label">Stop sequence</label>
              {!readOnly && stops.length > 1 && (
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
                    {!readOnly && stops.length > 1 && (
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
    <>
      {/* Two numbers, not three: a 280px panel gives each stat cell about
          85px, and a third one wrapped both its label and its value onto two
          lines. Round trip and fleet are the headline figures; layover is
          detail, so it goes in the sentence. */}
      <div className="stats">
        <Stat label="Round trip" value={roundTrip} />
        {active && <Stat label="Vehicles" value={String(stats.fleet)} />}
      </div>
      <p className="panel-hint">
        {!active
          ? `Not running at ${when}. A round trip takes ${roundTrip}.`
          : active.headwayMinutes === undefined
            ? `Running at ${when} with no frequency set, so it runs a single vehicle around a ${roundTrip} round trip.`
            : `At ${when} it runs every ${active.headwayMinutes} min${!pinnedPeriod && active.label ? ` (${active.label})` : ''}. ` +
              `${stopCount === 0 ? 'With no stops' : `${stopCount} stop${stopCount === 1 ? '' : 's'} and ${formatMinutes(dwell)} of dwell`}, a round trip takes ` +
              `${roundTrip}, so holding that headway needs ${stats.fleet} vehicle${stats.fleet === 1 ? '' : 's'}, ` +
              `each waiting ${formatMinutes(stats.layoverMs / 60_000)} at either end.`}
      </p>
    </>
  );
}
