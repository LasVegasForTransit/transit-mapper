import { useEditor, useEditorCommands } from '../../editor/EditorProvider';
import { useSelectionActions } from '../../editor/useSelectionActions';
import type { MultiSelectItem, Selection } from '../../editor/store';
import { Icon } from '../Icon';
import { NodeInspector } from '../NodeInspector';
import { Panel } from '../Panel';
import { FacilityInspector } from './FacilityInspector';
import { GroupInspector } from './GroupInspector';
import { LineInspector } from './LineInspector';
import { ServiceInspector } from './ServiceInspector';
import { StationInspector } from './StationInspector';
import { StopInspector } from './StopInspector';
import { WayInspector } from './WayInspector';

export interface SelectionInspectorContentProps {
  selection: Selection;
  multiSelection: MultiSelectItem[];
}

export default function SelectionInspectorContent({
  selection,
  multiSelection,
}: SelectionInspectorContentProps) {
  if (multiSelection.length > 0) return <MultiInspector items={multiSelection} />;
  if (!selection) return null;
  if (selection.kind === 'line') return <LineInspector key={selection.id} id={selection.id} />;
  // Switching to a different service must remount its locally derived custom
  // frequency/span disclosure instead of retaining the prior service's state.
  if (selection.kind === 'service') {
    return <ServiceInspector key={selection.id} id={selection.id} />;
  }
  if (selection.kind === 'way') return <WayInspector id={selection.id} />;
  if (selection.kind === 'facility') return <FacilityInspector id={selection.id} />;
  if (selection.kind === 'group') return <GroupInspector id={selection.id} />;
  if (selection.kind === 'node') return <NodeInspector id={selection.id} />;
  if (selection.kind === 'station') return <StationInspector id={selection.id} />;
  return <StopInspector id={selection.id} />;
}

const MULTI_KIND_LABEL: Record<MultiSelectItem['kind'], string> = {
  way: 'way',
  stop: 'stop',
  station: 'station',
  facility: 'facility',
  line: 'line',
  service: 'service',
};

interface MultiInspectorProps {
  items: MultiSelectItem[];
}

// Bulk actions only. The registry decides which actions exist, shared with
// the map action menu, so this surface cannot drift into a second policy.
function MultiInspector({ items }: MultiInspectorProps) {
  const readOnly = useEditor((state) => state.readOnly);
  const { clearMultiSelection } = useEditorCommands().selection;
  const { actions, note } = useSelectionActions();
  const counts = new Map<MultiSelectItem['kind'], number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const summary = [...counts.entries()]
    .map(([kind, count]) => `${count} ${MULTI_KIND_LABEL[kind]}${count === 1 ? '' : 's'}`)
    .join(', ');

  return (
    <Panel slot="right" aria-label="Selection details">
      <div className="insp-head">
        <span className="dot ring" />
        <span className="insp-name static">{items.length} selected</span>
      </div>
      <div className="insp-kind">{summary}</div>
      {!readOnly && (
        <p className="insp-sub">
          Drag any selected way, station, or facility to move the whole group · Shift-click to add
          or remove one
        </p>
      )}
      {note && (
        <p className="insp-sub" style={{ marginBottom: 12 }}>
          {note}
        </p>
      )}
      {actions
        .filter((action) => action.group !== 'destructive')
        .map((action) => (
          <div key={action.id}>
            <button
              type="button"
              className="ghost-btn"
              style={{ width: '100%', justifyContent: 'center', marginBottom: 4 }}
              onClick={action.run}
            >
              {action.label}
            </button>
            {action.hint && (
              <p className="insp-sub" style={{ marginBottom: 12 }}>
                {action.hint}
              </p>
            )}
          </div>
        ))}
      <button
        type="button"
        className="ghost-btn"
        style={{ width: '100%', justifyContent: 'center', marginBottom: 8 }}
        onClick={clearMultiSelection}
      >
        Clear selection
      </button>
      {!readOnly &&
        actions
          .filter((action) => action.group === 'destructive')
          .map((action) => (
            <button key={action.id} type="button" className="danger-btn" onClick={action.run}>
              <Icon name="trash" size={18} /> {action.label}
            </button>
          ))}
    </Panel>
  );
}
