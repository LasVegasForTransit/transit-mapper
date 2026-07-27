import { useState } from "react";
import { shortId } from "@transitmapper/core/model/ids";
import { MODES, MODE_ORDER } from "@transitmapper/core/model/catalog";
import type { VehicleKind } from "@transitmapper/core/model/system";
import { blurOnEnter } from "./formUtils";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

interface VehicleKindsDialogProps {
  /** The service that opened this dialog — a newly added kind defaults to
   *  its mode, but every kind in the system (any mode) is listed here. */
  modeId: string;
  vehicleKinds: VehicleKind[];
  readOnly: boolean;
  onSave: (kinds: VehicleKind[]) => void;
  onClose: () => void;
}

/**
 * System-wide manager for custom vehicle kinds — lets someone testing a
 * transit system idea define specific equipment (real size + top speed)
 * a line can be assigned to run, instead of every service of a mode
 * sharing one fixed default. Same live-commit local-array pattern as
 * ScheduleDialog: owns its own draft array, commits the WHOLE array back
 * via onSave on every change (store.ts's setVehicleKinds is a one-shot
 * replace), no separate Save step.
 */
export function VehicleKindsDialog({ modeId, vehicleKinds, readOnly, onSave, onClose }: VehicleKindsDialogProps) {
  const [kinds, setKinds] = useState<VehicleKind[]>(vehicleKinds);

  const commit = (next: VehicleKind[]) => {
    setKinds(next);
    onSave(next);
  };

  const updateKind = (kid: string, patch: Partial<VehicleKind>) => commit(kinds.map((k) => (k.id === kid ? { ...k, ...patch } : k)));
  const removeKind = (kid: string) => commit(kinds.filter((k) => k.id !== kid));
  const addKind = () => commit([...kinds, { id: shortId(), modeId, label: `${MODES[modeId]?.label ?? "Vehicle"} kind`, widthM: 2.6, lengthM: 12 }]);

  return (
    <Modal
      title="Vehicle kinds"
      description="Define specific vehicles a line can be assigned to run — its real size (drives the Infrastructure-view footprint) and top speed (drives how fast it animates). A service left unassigned keeps using its mode's plain default."
      onClose={onClose}
      className="schedule-modal"
    >
      {kinds.length === 0 ? (
        <p className="panel-hint">No custom vehicle kinds yet — every service is using its mode's plain default size and speed.</p>
      ) : (
        <ul className="schedule-list">
          {kinds.map((k) => (
            <li key={k.id} className="schedule-editor-row">
              <div className="schedule-editor-row-head">
                <input
                  className="schedule-label-input"
                  aria-label="Vehicle kind name"
                  value={k.label}
                  disabled={readOnly}
                  placeholder="Vehicle name"
                  onChange={(e) => updateKind(k.id, { label: e.target.value })}
                  onKeyDown={blurOnEnter}
                />
                {!readOnly && <IconButton icon="trash" size={15} label={`Delete ${k.label || "this vehicle kind"}`} onClick={() => removeKind(k.id)} />}
              </div>

              <label className="field-label" htmlFor={`vk-mode-${k.id}`}>
                Mode
              </label>
              <select
                id={`vk-mode-${k.id}`}
                className="opt-select"
                style={{ width: "100%", marginBottom: 8 }}
                disabled={readOnly}
                value={k.modeId}
                onChange={(e) => updateKind(k.id, { modeId: e.target.value })}
              >
                {MODE_ORDER.map((mid) => (
                  <option key={mid} value={mid}>
                    {MODES[mid].label}
                  </option>
                ))}
              </select>

              <div className="freq-row">
                <input
                  type="number"
                  min={0.5}
                  step={0.1}
                  className="freq-input"
                  aria-label={`${k.label || "Vehicle"} width in meters`}
                  value={k.widthM}
                  disabled={readOnly}
                  onChange={(e) => updateKind(k.id, { widthM: Math.max(0.5, Number(e.target.value) || 0.5) })}
                />
                <span className="freq-suffix">m wide</span>
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  className="freq-input"
                  aria-label={`${k.label || "Vehicle"} length in meters`}
                  value={k.lengthM}
                  disabled={readOnly}
                  onChange={(e) => updateKind(k.id, { lengthM: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span className="freq-suffix">m long</span>
              </div>

              <div className="freq-row">
                <input
                  type="number"
                  min={0}
                  className="freq-input"
                  aria-label={`${k.label || "Vehicle"} passenger capacity`}
                  placeholder="Not set"
                  value={k.capacityPax ?? ""}
                  disabled={readOnly}
                  onChange={(e) => updateKind(k.id, { capacityPax: e.target.value === "" ? undefined : Math.max(0, Math.round(Number(e.target.value))) })}
                />
                <span className="freq-suffix">passengers</span>
                <input
                  type="number"
                  min={0}
                  className="freq-input"
                  aria-label={`${k.label || "Vehicle"} top speed in km/h`}
                  placeholder="Not set"
                  value={k.topSpeedKmh ?? ""}
                  disabled={readOnly}
                  onChange={(e) => updateKind(k.id, { topSpeedKmh: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) })}
                />
                <span className="freq-suffix">km/h top speed</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <button type="button" className="ghost-btn" style={{ width: "100%", justifyContent: "center" }} onClick={addKind}>
          <Icon name="plus" size={17} /> Add vehicle kind
        </button>
      )}
    </Modal>
  );
}
