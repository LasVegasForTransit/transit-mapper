import { useEffect, useState } from 'react';
import { MODES, MODE_ORDER } from '@transitmapper/core/model/catalog';
import { serviceDisplayLabel, servicesForLine } from '@transitmapper/core/model/line-service';
import { useEditor, useEditorCommands } from '../../editor/EditorProvider';
import { ColorField } from '../ColorField';
import { Icon } from '../Icon';
import { Panel } from '../Panel';
import { blurOnEnter } from '../formUtils';
import { EmptyInspector } from './shared';
import type { Service } from '@transitmapper/core/model/system';

function NewServiceForm({
  lineId,
  initialModeId,
  onCancel,
}: {
  lineId: string;
  initialModeId: string;
  onCancel: () => void;
}) {
  const { startAddingServiceToLine } = useEditorCommands().services;
  const [serviceName, setServiceName] = useState('');
  const [serviceModeId, setServiceModeId] = useState(initialModeId);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!serviceName.trim()) return;
        startAddingServiceToLine(lineId, { name: serviceName, modeId: serviceModeId });
        onCancel();
      }}
    >
      <label className="field-label" htmlFor={`new-service-name-${lineId}`}>
        Technical label
      </label>
      <input
        id={`new-service-name-${lineId}`}
        className="insp-name-input"
        value={serviceName}
        placeholder="Airport express"
        autoFocus
        onChange={(event) => setServiceName(event.target.value)}
      />
      <label className="field-label" htmlFor={`new-service-mode-${lineId}`}>
        Mode
      </label>
      <select
        id={`new-service-mode-${lineId}`}
        className="opt-select"
        style={{ width: '100%', marginBottom: 8 }}
        value={serviceModeId}
        onChange={(event) => setServiceModeId(event.target.value)}
      >
        {MODE_ORDER.map((modeId) => (
          <option key={modeId} value={modeId}>
            {MODES[modeId].label}
          </option>
        ))}
      </select>
      <div className="insp-actions" style={{ marginBottom: 12 }}>
        <button type="submit" className="primary-btn" disabled={!serviceName.trim()}>
          Draw service
        </button>
        <button type="button" className="ghost-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function LineServiceActions({ lineId, services }: { lineId: string; services: Service[] }) {
  const addingServiceDraft = useEditor((state) => state.addingServiceDraft);
  const { cancelAddingService, deleteLine } = useEditorCommands().services;
  const [configuringService, setConfiguringService] = useState(false);

  useEffect(() => setConfiguringService(false), [lineId]);

  if (addingServiceDraft?.lineId === lineId) {
    return (
      <>
        <p className="insp-sub">
          Draw the additional Service path on the map. It will stay grouped under this public Line.
        </p>
        <button
          type="button"
          className="ghost-btn"
          style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
          onClick={cancelAddingService}
        >
          Cancel adding service
        </button>
      </>
    );
  }
  return (
    <>
      {configuringService ? (
        <NewServiceForm
          lineId={lineId}
          initialModeId={services.at(0)?.modeId ?? MODE_ORDER[0]}
          onCancel={() => setConfiguringService(false)}
        />
      ) : (
        <button
          type="button"
          className="ghost-btn"
          style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
          onClick={() => setConfiguringService(true)}
        >
          <Icon name="plus" size={17} /> Add service
        </button>
      )}
      <button type="button" className="danger-btn" onClick={() => deleteLine(lineId)}>
        <Icon name="trash" size={16} /> Delete line and its services
      </button>
    </>
  );
}

export function LineInspector({ id }: { id: string }) {
  const system = useEditor((state) => state.system);
  const commands = useEditorCommands();
  const { setLineName, setLineColor } = commands.services;
  const { addPaletteColor } = commands.tools;
  const { selectAndFocus } = commands.selection;
  const line = system.lines.find((candidate) => candidate.id === id);

  if (!line) return <EmptyInspector />;
  const services = servicesForLine(system, id);

  return (
    <Panel slot="right" aria-label="Line details">
      <div className="insp-head">
        <span className="dot" style={{ background: line.color }} />
        <input
          className="insp-name"
          aria-label="Line name"
          value={line.name}
          onChange={(event) => setLineName(id, event.target.value)}
          onKeyDown={blurOnEnter}
        />
      </div>
      <div className="insp-kind">Public identity · shown on the passenger map</div>

      <div className="insp-section">
        <ColorField
          value={line.color}
          palette={system.palette}
          onChange={(color) => setLineColor(id, color)}
          onAddToPalette={addPaletteColor}
        />

        <label className="field-label">Services</label>
        <p className="insp-sub">
          A service is one mode-specific operation with its own path and schedule. A line can group
          several services when the agency presents them as one identity.
        </p>
        <div className="svc-list">
          {services.map((service) => (
            <button
              key={service.id}
              type="button"
              className="svc-chip"
              aria-label={`Inspect ${serviceDisplayLabel(system, service.id)}`}
              onClick={() => selectAndFocus({ kind: 'service', id: service.id })}
            >
              <span className="dot sm" style={{ background: line.color }} />
              {serviceDisplayLabel(system, service.id)}
              <span className="list-tag">{MODES[service.modeId].label}</span>
            </button>
          ))}
        </div>

        <LineServiceActions lineId={id} services={services} />
      </div>
    </Panel>
  );
}
