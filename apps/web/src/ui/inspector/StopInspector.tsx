import { useEffect, useRef, type RefObject } from 'react';
import { lineForService, serviceDisplayLabel } from '@transitmapper/core/model/line-service';
import type { Service, Stop, TransitSystem } from '@transitmapper/core/model/system';
import { servicesAtStop } from '@transitmapper/core/sim/frequency';
import { useEditor, useEditorCommands } from '../../editor/EditorProvider';
import { blurOnEnter } from '../formUtils';
import { Icon } from '../Icon';
import { IconButton } from '../IconButton';
import { Panel } from '../Panel';
import { EmptyInspector } from './shared';

export interface StopInspectorProps {
  id: string;
}

interface StopRelationshipsProps {
  id: string;
  stop: Stop;
  system: TransitSystem;
  served: Service[];
  attachStop: (stationId: string, stopId: string) => void;
  detachStop: (stopId: string) => void;
  selectCall: (serviceId: string, stopId: string) => void;
}

function StopRelationships({
  id,
  stop,
  system,
  served,
  attachStop,
  detachStop,
  selectCall,
}: StopRelationshipsProps) {
  return (
    <>
      {stop.anchors.length === 0 && (
        <div className="panel-hint">Free stop — drag it onto a way to attach it.</div>
      )}
      <label className="field-label" htmlFor="stop-station">
        Station
      </label>
      <select
        id="stop-station"
        className="opt-select"
        value={stop.stationId ?? ''}
        onChange={(event) =>
          event.target.value ? attachStop(event.target.value, id) : detachStop(id)
        }
      >
        <option value="">No station</option>
        {system.stations.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name?.trim() ? candidate.name : 'Unnamed station'}
          </option>
        ))}
      </select>
      <label className="field-label">Served by</label>
      <div className="svc-list">
        {served.length === 0 && <span className="panel-hint">No services call here</span>}
        {served.map((service) => (
          <button key={service.id} className="svc-chip" onClick={() => selectCall(service.id, id)}>
            <span
              className="dot sm"
              style={{ background: lineForService(system, service.id)?.color }}
            />{' '}
            {serviceDisplayLabel(system, service.id)}
          </button>
        ))}
      </div>
    </>
  );
}

interface StopSettingsProps {
  id: string;
  stop: Stop;
  setDwell: (id: string, seconds: number | undefined) => void;
  setMajor: (id: string, major: boolean) => void;
}

interface StopHeaderProps {
  id: string;
  stop: Stop;
  system: TransitSystem;
  served: Service[];
  stationName: string;
  inputRef: RefObject<HTMLInputElement>;
  setName: (id: string, name: string) => void;
  suggestName: (id: string) => void;
}

function StopHeader({
  id,
  stop,
  system,
  served,
  stationName,
  inputRef,
  setName,
  suggestName,
}: StopHeaderProps) {
  return (
    <>
      <div className="insp-head">
        <span
          className="dot"
          style={{
            background: served[0]
              ? lineForService(system, served[0].id)?.color
              : 'var(--md-sys-color-outline)',
          }}
        />
        <input
          ref={inputRef}
          className="insp-name"
          aria-label="Stop name"
          placeholder="Unnamed stop"
          value={stop.name ?? ''}
          onChange={(event) => setName(id, event.target.value)}
          onKeyDown={blurOnEnter}
        />
        {!stop.name && (
          <IconButton
            icon="redo"
            size={15}
            label="Suggest a name from nearby cross streets"
            onClick={() => suggestName(id)}
          />
        )}
      </div>
      <div className="insp-kind">Stop · {stationName}</div>
    </>
  );
}

function StopSettings({ id, stop, setDwell, setMajor }: StopSettingsProps) {
  return (
    <>
      <label className="field-label" htmlFor="dwell-input">
        Dwell time
      </label>
      <p className="insp-sub">How long a vehicle waits at this boarding point.</p>
      <div className="freq-row">
        <input
          id="dwell-input"
          type="number"
          min={0}
          className="freq-input"
          aria-label="Dwell time in seconds"
          value={stop.dwellSeconds ?? ''}
          placeholder="20 (default)"
          onChange={(event) =>
            setDwell(
              id,
              event.target.value === ''
                ? undefined
                : Math.max(0, Math.round(Number(event.target.value))),
            )
          }
          onKeyDown={blurOnEnter}
        />
        <span className="freq-suffix">seconds</span>
      </div>
      <label className="lp-row" style={{ marginTop: 12 }}>
        <input
          type="checkbox"
          checked={stop.majorStop === true}
          onChange={(event) => setMajor(id, event.target.checked)}
        />
        Major stop
      </label>
    </>
  );
}

/** Physical boarding-point editing. Station-scale land and platforms live in
 * StationInspector; a Service call reaches this inspector only through the
 * explicit link from ServiceInspector. */
export function StopInspector({ id }: StopInspectorProps) {
  const stop = useEditor((state) => state.system.stops.find((candidate) => candidate.id === id));
  const system = useEditor((state) => state.system);
  const focusNameToken = useEditor((state) => state.focusNameToken);
  const focusNameStopId = useEditor((state) => state.focusNameStopId);
  const {
    setStopName,
    suggestStopName,
    setStopDwellSeconds,
    setStopMajorStop,
    deleteStop,
    consumeFocusName,
  } = useEditorCommands().stops;
  const { attachStop, detachStop } = useEditorCommands().stations;
  const { selectAndFocus } = useEditorCommands().selection;
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusNameStopId !== id) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
    consumeFocusName(id);
  }, [consumeFocusName, focusNameStopId, focusNameToken, id]);

  if (!stop) return <EmptyInspector />;
  const served = servicesAtStop(system.ways, system.services, stop);
  const station = stop.stationId
    ? system.stations.find((candidate) => candidate.id === stop.stationId)
    : undefined;

  return (
    <Panel slot="right" aria-label="Stop details">
      <StopHeader
        id={id}
        stop={stop}
        system={system}
        served={served}
        stationName={station?.name ?? (station ? 'Unnamed station' : 'standalone boarding point')}
        inputRef={nameInputRef}
        setName={setStopName}
        suggestName={suggestStopName}
      />

      <div className="insp-section">
        <StopRelationships
          id={id}
          stop={stop}
          system={system}
          served={served}
          attachStop={attachStop}
          detachStop={detachStop}
          selectCall={(serviceId, stopId) =>
            selectAndFocus({ kind: 'service', id: serviceId, stopId })
          }
        />
        <StopSettings
          id={id}
          stop={stop}
          setDwell={setStopDwellSeconds}
          setMajor={setStopMajorStop}
        />
      </div>

      <div className="insp-footer">
        <button className="danger-btn" onClick={() => deleteStop(id)}>
          <Icon name="trash" size={18} /> Delete stop
        </button>
      </div>
    </Panel>
  );
}
