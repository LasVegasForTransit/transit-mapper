import { useState } from 'react';
import { useEditor, useEditorCommands } from '../../editor/EditorProvider';
import { useDocumentView } from '../../editor/document-view-controls';
import {
  FACILITY_TYPE_ORDER,
  FACILITY_TYPES,
  facilityType,
} from '@transitmapper/core/model/catalog';
import type { Stop, TransitSystem } from '@transitmapper/core/model/system';
import type { Selection } from '../../editor/store';
import { ColorField } from '../ColorField';
import { InspectorTabs, type InspectorTab } from '../InspectorTabs';
import { Panel } from '../Panel';
import { blurOnEnter } from '../formUtils';
import { Icon } from '../Icon';
import { EmptyInspector, Stat } from './shared';
// A group member can be a stop, facility, public Line, or technical Service
// — resolve both its display name AND its real
// selection kind, so clicking a row selects the right kind of thing instead
// of always assuming "stop".
interface MemberLookup {
  stops: Stop[];
  facilities: TransitSystem['facilities'];
  lines: TransitSystem['lines'];
  services: TransitSystem['services'];
}

function memberInfo(
  { stops, facilities, lines, services }: MemberLookup,
  memberId: string,
): { selection: Selection; label: string } | null {
  const stop = stops.find((s) => s.id === memberId);
  if (stop)
    return {
      selection: { kind: 'stop', id: memberId },
      label: stop.name ?? 'Unnamed stop',
    };
  const facility = facilities.find((f) => f.id === memberId);
  if (facility)
    return {
      selection: { kind: 'facility', id: memberId },
      label: facility.name ?? facilityType(facility.typeId).label,
    };
  const line = lines.find((candidate) => candidate.id === memberId);
  if (line)
    return { selection: { kind: 'line', id: memberId }, label: line.name || 'Unnamed line' };
  const service = services.find((sv) => sv.id === memberId);
  if (service)
    return { selection: { kind: 'service', id: memberId }, label: service.name ?? 'Service' };
  return null;
}

export interface GroupInspectorProps {
  id: string;
}

// Task-based: Members (what's bundled + adding more) vs Site (the physical
// boundary and its color). Same shell as every other inspector.
export function GroupInspector({ id }: GroupInspectorProps) {
  const group = useEditor((s) => s.system.groups.find((g) => g.id === id));
  // Narrow selectors, not the whole `system` — see ServiceInspector's note.
  const stops = useEditor((s) => s.system.stops);
  const facilities = useEditor((s) => s.system.facilities);
  const lines = useEditor((s) => s.system.lines);
  const services = useEditor((s) => s.system.services);
  const palette = useEditor((s) => s.system.palette);
  const readOnly = useEditor((s) => s.readOnly);
  const {
    groups: { renameGroup, setGroupColor, removeGroupMember, deleteGroup },
    tools: { addPaletteColor },
    selection: { selectAndFocus },
  } = useEditorCommands();
  const [tab, setTab] = useState<string>('members');

  if (!group) return <EmptyInspector />;
  const isComplex = !!group.footprint;

  const tabs: InspectorTab[] = [
    { id: 'members', label: 'Members' },
    { id: 'site', label: 'Site' },
  ];

  return (
    <Panel slot="right" aria-label="Selection details">
      <div className="insp-head">
        {group.color ? (
          <span className="dot" style={{ background: group.color }} />
        ) : (
          <span className="dot ring" />
        )}
        <input
          className="insp-name"
          aria-label="Group name"
          placeholder={isComplex ? 'Facility complex' : 'Complex'}
          value={group.name ?? ''}
          disabled={readOnly}
          onChange={(e) => renameGroup(id, e.target.value)}
          onKeyDown={blurOnEnter}
        />
      </div>
      <div className="insp-kind">
        {isComplex
          ? 'Facility complex · a real physical site'
          : 'Group · bundles objects into one unit'}
      </div>

      <InspectorTabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'members' && (
        <div className="insp-section" role="tabpanel">
          <label className="field-label">Members</label>
          <div className="svc-list">
            {group.memberIds.length === 0 && <span className="panel-hint">No members yet</span>}
            {group.memberIds.map((mid) => {
              const info = memberInfo({ stops, facilities, lines, services }, mid);
              return (
                <div key={mid} className="svc-chip chip-removable">
                  {info ? (
                    <button
                      className="chip-removable-label"
                      onClick={() => selectAndFocus(info.selection)}
                    >
                      {info.label}
                    </button>
                  ) : (
                    <span className="chip-removable-label">Unknown</span>
                  )}
                  {!readOnly && (
                    <button
                      className="chip-remove-btn"
                      aria-label="Remove member"
                      onClick={() => removeGroupMember(id, mid)}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <GroupPlacement groupId={id} readOnly={readOnly} />
        </div>
      )}

      {tab === 'site' && (
        <div className="insp-section" role="tabpanel">
          {isComplex && group.color && (
            <div className="insp-field">
              <ColorField
                value={group.color}
                palette={palette}
                disabled={readOnly}
                onChange={(c) => setGroupColor(id, c)}
                onAddToPalette={addPaletteColor}
              />
            </div>
          )}
          <GroupFootprint groupId={id} readOnly={readOnly} />
        </div>
      )}

      {!readOnly && (
        <div className="insp-footer">
          <button className="danger-btn" onClick={() => deleteGroup(id)}>
            <Icon name="trash" size={18} /> Delete {isComplex ? 'complex' : 'group'}
          </button>
        </div>
      )}
    </Panel>
  );
}

// A facility complex's physical site — same draw/reshape pattern as a
// stop's footprint (see StopFootprint above), just owned by the Group.
interface GroupFootprintProps {
  groupId: string;
  readOnly: boolean;
}

function GroupFootprint({ groupId, readOnly }: GroupFootprintProps) {
  const group = useEditor((s) => s.system.groups.find((g) => g.id === groupId));
  const { addGroupFootprint, deleteGroupFootprint } = useEditorCommands().groups;
  const { setViewMode } = useDocumentView();
  if (!group) return null;

  // Same reasoning as StopFootprint's drawFootprint — a group footprint
  // only ever renders in the Infrastructure view.
  const drawBoundary = () => {
    addGroupFootprint(groupId);
    setViewMode('infrastructure');
  };

  return (
    <>
      <label className="field-label">Site boundary</label>
      {!group.footprint ? (
        <>
          <p className="insp-sub">
            Draw a boundary to turn this into a facility complex — visible &amp; editable in the
            Infrastructure view
          </p>
          {!readOnly && (
            <button className="add-btn" onClick={drawBoundary}>
              <Icon name="plus" size={17} /> Draw boundary
            </button>
          )}
        </>
      ) : (
        <>
          {!readOnly && (
            <p className="insp-sub">
              Drag a corner in the Infrastructure view to reshape · Alt-click to erase one
            </p>
          )}
          <div className="stats">
            <Stat label="Corners" value={String(group.footprint.length)} />
          </div>
          {!readOnly && (
            <button className="danger-btn" onClick={() => deleteGroupFootprint(groupId)}>
              <Icon name="trash" size={18} /> Remove boundary
            </button>
          )}
        </>
      )}
    </>
  );
}

// The turnkey way to build up a facility complex: place a new, catalog-typed
// facility straight into this group (arms the Facility tool for one click),
// or add something already on the map (arms Select to pick the next click).
interface GroupPlacementProps {
  groupId: string;
  readOnly: boolean;
}

function GroupPlacement({ groupId, readOnly }: GroupPlacementProps) {
  const draftFacilityTypeId = useEditor((s) => s.draftFacilityTypeId);
  const placingFor = useEditor((s) => s.placingFacilityForGroupId);
  const pickingFor = useEditor((s) => s.pickingMemberForGroupId);
  const { setDraftFacilityType } = useEditorCommands().tools;
  const { startPlacingFacility, cancelPlacingFacility, startPickingMember, cancelPickingMember } =
    useEditorCommands().groups;

  if (readOnly) return null;
  const placing = placingFor === groupId;
  const picking = pickingFor === groupId;

  return (
    <>
      <label className="field-label">Add to this complex</label>
      {placing ? (
        <div className="insp-row-actions">
          <span className="panel-hint">
            Click the map to place a {FACILITY_TYPES[draftFacilityTypeId].label.toLowerCase()}…
          </span>
          <button className="ghost-btn" onClick={cancelPlacingFacility}>
            Cancel
          </button>
        </div>
      ) : picking ? (
        <div className="insp-row-actions">
          <span className="panel-hint">Click a stop or facility on the map to add it…</span>
          <button className="ghost-btn" onClick={cancelPickingMember}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <div className="insp-row-actions">
            <select
              className="opt-select"
              value={draftFacilityTypeId}
              onChange={(e) => setDraftFacilityType(e.target.value)}
            >
              {FACILITY_TYPE_ORDER.map((tid) => (
                <option key={tid} value={tid}>
                  {FACILITY_TYPES[tid].label}
                </option>
              ))}
            </select>
            <button className="add-btn" onClick={() => startPlacingFacility(groupId)}>
              <Icon name="plus" size={17} /> Place inside
            </button>
          </div>
          <button
            className="add-btn"
            style={{ marginTop: 8 }}
            onClick={() => startPickingMember(groupId)}
          >
            <Icon name="cursor" size={16} /> Add existing…
          </button>
        </>
      )}
    </>
  );
}
