import { useEffect, useRef, type ReactNode } from 'react';
import { useEditor } from '../editor/EditorProvider';
import { useSelectionActions } from '../editor/useSelectionActions';
import type { MultiSelectItem, Selection, Tool } from '../editor/store';
import { Icon } from './Icon';
import { NodeInspector } from './NodeInspector';
import { Panel } from './Panel';
import { useDelayedUnmount } from './useDelayedUnmount';
import { useView, type ViewMode } from './ViewProvider';
import { ToolDraftInspector } from './inspector/drafts';
import { ServiceInspector } from './inspector/ServiceInspector';
import { WayInspector } from './inspector/WayInspector';
import { StationInspector } from './inspector/StationInspector';
import { FacilityInspector } from './inspector/FacilityInspector';
import { GroupInspector } from './inspector/GroupInspector';

function renderInspectorContent(
  selection: Selection,
  multiSelection: MultiSelectItem[],
): ReactNode {
  if (multiSelection.length > 0) return <MultiInspector items={multiSelection} />;
  if (!selection) return null;
  // key={id}: switching selection to a DIFFERENT service must remount, not
  // reuse this instance — its "Custom" frequency/span disclosure is local
  // state derived once at mount from that service's own values (see
  // ServiceInspector), and would otherwise stay stuck open/closed from
  // whichever service was selected previously.
  if (selection.kind === 'service')
    return <ServiceInspector key={selection.id} id={selection.id} />;
  if (selection.kind === 'way') return <WayInspector id={selection.id} />;
  if (selection.kind === 'facility') return <FacilityInspector id={selection.id} />;
  if (selection.kind === 'group') return <GroupInspector id={selection.id} />;
  if (selection.kind === 'node') return <NodeInspector id={selection.id} />;
  return <StationInspector id={selection.id} />;
}

// Slides in once there's something to say — either a selection, or (an
// armed drawing tool takes priority over a stale selection here, matching
// "what you're doing right now" rather than "what you clicked before you
// picked up a tool") that tool's own draft options. An empty inspector is
// chrome with nothing to say, so it doesn't occupy the immersive map
// otherwise. Slides back out the same way once BOTH clear: stays mounted
// (showing the last real content) for the CSS exit transition's duration
// instead of vanishing the instant either one clears — see useDelayedUnmount.
/**
 * What the one dynamic surface should be showing.
 *
 * This is the single answer to a question three call sites used to compute
 * separately — Inspector's own open state, App's `hasSupplementalContent`, and
 * App's sheet auto-expand — from the same four store fields. Three formulas
 * over the same inputs is how the mobile sheet ended up opening over an empty
 * panel; there is one now.
 */
export type SupplementalContent =
  { kind: 'none' } | { kind: 'selection' } | { kind: 'tool-draft'; tool: Tool };

export interface SupplementalInput {
  tool: Tool;
  readOnly: boolean;
  viewMode: ViewMode;
  hasSelection: boolean;
}

/**
 * The decision itself, as a plain function of four facts.
 *
 * Pure so the rules below can be verified without a renderer, the same shape
 * editor/pointerIntent.ts uses for the pointer vocabulary.
 */
export function supplementalContentFor({
  tool,
  readOnly,
  viewMode,
  hasSelection,
}: SupplementalInput): SupplementalContent {
  // Diagram and read-only both disable the drawing tools outright (see
  // Toolbar's `locked`), so an armed tool from before switching there must not
  // still claim this slot. A selection can still be inspected.
  if (readOnly || viewMode === 'diagram') {
    return hasSelection ? { kind: 'selection' } : { kind: 'none' };
  }
  // An armed drawing tool is what you are doing right now, and outranks
  // whatever was selected before you picked it up. Select has no options of
  // its own — erasing and splitting are variants on its dock button — so it
  // shows a selection or nothing.
  if (tool !== 'select') return { kind: 'tool-draft', tool };
  return hasSelection ? { kind: 'selection' } : { kind: 'none' };
}

export function useSupplementalContent(): SupplementalContent {
  const tool = useEditor((s) => s.tool);
  const readOnly = useEditor((s) => s.readOnly);
  const selection = useEditor((s) => s.selection);
  const multiSelection = useEditor((s) => s.multiSelection);
  const { viewMode } = useView();
  return supplementalContentFor({
    tool,
    readOnly,
    viewMode,
    hasSelection: selection !== null || multiSelection.length > 0,
  });
}

/**
 * What is being inspected, as a value that changes when the SUBJECT changes.
 *
 * Not a render key — the panel is deliberately not remounted for every kind
 * (see renderInspectorContent's own note) — just something to compare so the
 * scroll reset below knows a different object is showing.
 */
function subjectOf(content: SupplementalContent, selection: Selection, count: number): string {
  if (content.kind === 'tool-draft') return `tool:${content.tool}`;
  if (count > 0) return `multi:${count}`;
  return selection ? `${selection.kind}:${selection.id}` : 'none';
}

export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const multiSelection = useEditor((s) => s.multiSelection);
  const content = useSupplementalContent();
  const { mounted, closing } = useDelayedUnmount(content.kind !== 'none', 160);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const subject = subjectOf(content, selection, multiSelection.length);

  // A panel scrolled halfway down keeps that offset when a different object
  // is put into it, because the scroll lives on a container that never
  // unmounts. Measured: selecting a line after scrolling a station's panel
  // opened at scrollTop 134 — the first thing showing was "MODE", with the
  // line's own name and its tabs above the fold. You pick a line and get an
  // anonymous form.
  //
  // Walks up to whichever element actually scrolls, because that differs by
  // layout: the docked card is its own scroller, the compact workbench's
  // panel is one level further out.
  useEffect(() => {
    for (let el = rootRef.current?.parentElement; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible') {
        el.scrollTop = 0;
        return;
      }
    }
  }, [subject]);

  const current =
    content.kind === 'tool-draft' ? (
      <ToolDraftInspector tool={content.tool} />
    ) : (
      renderInspectorContent(selection, multiSelection)
    );
  const lastContent = useRef<ReactNode>(current);
  if (current !== null) lastContent.current = current;

  if (!mounted) return null;
  return (
    <div ref={rootRef} data-inspector-state={closing ? 'closed' : 'open'}>
      {current ?? lastContent.current}
    </div>
  );
}

const MULTI_KIND_LABEL: Record<MultiSelectItem['kind'], string> = {
  way: 'way',
  station: 'station',
  facility: 'facility',
  service: 'line',
};

interface MultiInspectorProps {
  items: MultiSelectItem[];
}

// Bulk actions only — moving/deleting several objects at once as one group,
// not editing shared properties across mixed kinds (a way and a station have
// nothing in common to show one merged form for).
//
// Which actions exist is not decided here: the registry answers that from the
// selection, and this renders whatever came back. The same list is what the
// map's right-click menu shows, so an action can never appear in one surface
// and not the other.
function MultiInspector({ items }: MultiInspectorProps) {
  const readOnly = useEditor((s) => s.readOnly);
  const clearMultiSelection = useEditor((s) => s.clearMultiSelection);
  const { actions, note } = useSelectionActions();

  const counts = new Map<MultiSelectItem['kind'], number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const summary = [...counts.entries()]
    .map(([kind, n]) => `${n} ${MULTI_KIND_LABEL[kind]}${n === 1 ? '' : 's'}`)
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
