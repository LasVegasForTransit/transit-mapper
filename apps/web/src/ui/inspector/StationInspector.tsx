import { useState } from 'react';
import { lineForService, serviceDisplayLabel } from '@transitmapper/core/model/line-service';
import { servicesAtStop } from '@transitmapper/core/sim/frequency';
import { useEditor, useEditorCommands } from '../../editor/EditorProvider';
import { blurOnEnter } from '../formUtils';
import { Icon } from '../Icon';
import { Panel } from '../Panel';
import { EmptyInspector } from './shared';

export interface StationInspectorProps {
  id: string;
}

/** Passenger-place editing. Calls and dwell remain Stop concerns. */
export function StationInspector({ id }: StationInspectorProps) {
  const station = useEditor((state) =>
    state.system.stations.find((candidate) => candidate.id === id),
  );
  const system = useEditor((state) => state.system);
  const readOnly = useEditor((state) => state.readOnly);
  const {
    setStationName,
    deleteStation,
    addStationFootprint,
    deleteStationFootprint,
    addPlatform,
    deletePlatform,
    attachStop,
    detachStop,
  } = useEditorCommands().stations;
  const { selectAndFocus } = useEditorCommands().selection;
  const [pickedStopId, setPickedStopId] = useState('');

  if (!station) return <EmptyInspector />;
  const containedStops = system.stops.filter((stop) => stop.stationId === station.id);
  const availableStops = system.stops.filter((stop) => !stop.stationId);
  const callingServices = [
    ...new Map(
      containedStops
        .flatMap((stop) => servicesAtStop(system.ways, system.services, stop))
        .map((service) => [service.id, service]),
    ).values(),
  ];

  return (
    <Panel slot="right" aria-label="Station details">
      <div className="insp-head">
        <span className="dot ring" />
        <input
          className="insp-name"
          aria-label="Station name"
          placeholder="Unnamed station"
          value={station.name ?? ''}
          disabled={readOnly}
          onChange={(event) => setStationName(id, event.target.value)}
          onKeyDown={blurOnEnter}
        />
      </div>
      <div className="insp-kind">
        Station · {containedStops.length} stop{containedStops.length === 1 ? '' : 's'}
      </div>

      <div className="insp-section">
        <label className="field-label">Stops</label>
        <div className="svc-list">
          {containedStops.length === 0 && (
            <span className="panel-hint">No boarding Stops attached</span>
          )}
          {containedStops.map((stop) => (
            <div key={stop.id} className="svc-chip chip-removable">
              <button
                className="chip-removable-label"
                onClick={() => selectAndFocus({ kind: 'stop', id: stop.id })}
              >
                {stop.name?.trim() ? stop.name : 'Unnamed stop'}
              </button>
              {!readOnly && (
                <button
                  className="chip-remove-btn"
                  aria-label={`Detach ${stop.name?.trim() ? stop.name : 'unnamed stop'}`}
                  onClick={() => detachStop(stop.id)}
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        {!readOnly && availableStops.length > 0 && (
          <div className="insp-row-actions">
            <select
              className="opt-select"
              aria-label="Stop to attach"
              value={pickedStopId}
              onChange={(event) => setPickedStopId(event.target.value)}
            >
              <option value="">Choose a stop…</option>
              {availableStops.map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {stop.name?.trim() ? stop.name : 'Unnamed stop'}
                </option>
              ))}
            </select>
            <button
              className="add-btn"
              disabled={!pickedStopId}
              onClick={() => {
                attachStop(id, pickedStopId);
                setPickedStopId('');
              }}
            >
              <Icon name="plus" size={17} /> Attach
            </button>
          </div>
        )}

        <label className="field-label">Calling services</label>
        <div className="svc-list">
          {callingServices.length === 0 && <span className="panel-hint">No service yet</span>}
          {callingServices.map((service) => (
            <button
              key={service.id}
              className="svc-chip"
              onClick={() => selectAndFocus({ kind: 'service', id: service.id })}
            >
              <span
                className="dot sm"
                style={{ background: lineForService(system, service.id)?.color }}
              />{' '}
              {serviceDisplayLabel(system, service.id)}
            </button>
          ))}
        </div>

        <label className="field-label">Physical boundary</label>
        {!station.footprint ? (
          !readOnly && (
            <button className="add-btn" onClick={() => addStationFootprint(id)}>
              <Icon name="plus" size={17} /> Add footprint
            </button>
          )
        ) : (
          <>
            <div className="stats">
              <span>{station.footprint.length} corners</span>
              <span>{station.platforms?.length ?? 0} platforms</span>
            </div>
            {!readOnly && (
              <div className="insp-row-actions">
                <button className="add-btn" onClick={() => addPlatform(id)}>
                  <Icon name="plus" size={17} /> Add platform
                </button>
                <button className="danger-btn" onClick={() => deleteStationFootprint(id)}>
                  Remove footprint
                </button>
              </div>
            )}
          </>
        )}
        {(station.platforms ?? []).map((platform, index) => (
          <div key={platform.id} className="svc-chip chip-removable">
            <span className="chip-removable-label">Platform {index + 1}</span>
            {!readOnly && (
              <button
                className="chip-remove-btn"
                aria-label={`Remove platform ${index + 1}`}
                onClick={() => deletePlatform(id, platform.id)}
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {!readOnly && (
        <div className="insp-footer">
          <button className="danger-btn" onClick={() => deleteStation(id)}>
            <Icon name="trash" size={18} /> Delete station
          </button>
        </div>
      )}
    </Panel>
  );
}
