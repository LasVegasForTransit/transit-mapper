import { useEditor, useEditorStore } from '../editor/EditorProvider';
import { forkSystem } from '@transitmapper/core/model/serialize';
import { blurOnEnter } from './formUtils';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu';
import { DrivingSidePopover } from './DrivingSidePopover';
import { ExportSplitButton } from './ExportSplitButton';
import { FileMenu } from './FileMenu';
import { IconButton } from './IconButton';
import { IssuesPopover } from './IssuesPopover';
import { LayersPopover } from './LayersPopover';
import { useInertRef } from './useInertRef';
import { useUi } from './UiProvider';
import { useView, type ViewMode } from './ViewProvider';
import { Icon } from './Icon';

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
  { mode: 'network', label: 'Network' },
  { mode: 'infrastructure', label: 'Infrastructure' },
  { mode: 'diagram', label: 'Diagram' },
];

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';

/** Persistent state of the canvas, not a transient action — kept visually
 *  distinct from TopBarActions' button cluster. Desktop: Workbench's own
 *  viewSwitcher prop. Mobile: folded into TopBarActions instead (see that
 *  component) — no room for a third floating group at that width.
 *
 *  Unlike sim controls (its constant companion in the same top-center
 *  card), this DOES collapse in zen mode — self-managed here via
 *  `.zen-collapse-cluster` + `inert` rather than threaded through
 *  Workbench, since it owns its own root element. That class shrinks its
 *  own max-width to 0 (not just a fade/lift like `.zen-cluster`) so sim
 *  controls slides into the freed width through ordinary flex reflow —
 *  no repositioning code needed for that motion. */
export function ViewSwitch() {
  const { viewMode, setViewMode } = useView();
  const { uiHidden } = useUi();
  const ref = useInertRef<HTMLDivElement>(uiHidden);
  return (
    <div ref={ref} className="segmented zen-collapse-cluster" role="group" aria-label="View">
      {VIEW_MODES.map((v) => (
        <button
          key={v.mode}
          className={`seg ${viewMode === v.mode ? 'active' : ''}`}
          aria-pressed={viewMode === v.mode}
          onClick={() => setViewMode(v.mode)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** File/brand/Hide-UI/system-name — Workbench's own brand prop, rendered
 *  into the menu panel's header on desktop (a floating card up here right
 *  above another one read as an overlap, not two panels) and into the top
 *  bar on mobile instead, where the menu panel is a bottom sheet with
 *  nowhere to put a header. See Workbench.tsx's own comment. */
export function TopBarBrand() {
  const name = useEditor((s) => s.system.name);
  const readOnly = useEditor((s) => s.readOnly);
  const setName = useEditor((s) => s.setName);
  const { uiHidden, toggleUi } = useUi();
  return (
    <>
      {/* One row, always, in every state: FileMenu icon at the left (a
          read-only view keeps only the app's About action), the system name
          filling the middle, the toggle fixed at
          the right — never three lines, never a wrap. FileMenu's own
          "TransitMapper" wordmark doesn't render here at all (see
          FileMenu.tsx) — the middle of this row is the system name's
          permanently, not the app's own name conditionally collapsing
          into it. */}
      <FileMenu />
      {readOnly ? (
        <span className="ro-name">{name}</span>
      ) : (
        <input
          className="system-name"
          value={name}
          aria-label="System name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={blurOnEnter}
        />
      )}
      <span className="brand-hide-ui">
        <IconButton
          icon="sidebar"
          size={17}
          label={uiHidden ? 'Show UI (\\)' : 'Hide UI (\\)'}
          onClick={toggleUi}
        />
      </span>
    </>
  );
}

/**
 * The transient-action button cluster — one markup for every viewport.
 * Which subset shows is a LAYOUT decision made by the container: a
 * `.actions-full` container (desktop card) shows everything and hides the
 * overflow menu; a `.actions-collapsed` container (mobile's vertical
 * column) shows only the primary few (`.act-secondary` hides) plus the ⋯
 * overflow carrying the rest. Same component, same handlers, no per-device
 * behavior forks.
 */
export function TopBarActions() {
  const store = useEditorStore();
  const readOnly = useEditor((s) => s.readOnly);
  const setSystem = useEditor((s) => s.setSystem);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const { openShortcuts, openDialog, toggleUi } = useUi();

  const fork = () => {
    const forked = forkSystem(store.getState().system);
    setSystem(forked, { readOnly: false });
    // Drop the /s/:id path so edits are clearly local.
    window.history.replaceState(null, '', '/');
  };

  return (
    <>
      {!readOnly && (
        <span className="act-secondary">
          <IssuesPopover />
        </span>
      )}
      <LayersPopover />
      {!readOnly && (
        <span className="act-secondary">
          <DrivingSidePopover />
        </span>
      )}
      <span className="act-secondary">
        <IconButton icon="keyboard" onClick={openShortcuts} label="Keyboard shortcuts (?)" />
      </span>
      <span className="act-secondary">
        <IconButton icon="play" onClick={() => openDialog('onboarding')} label="Replay intro" />
      </span>
      {readOnly ? (
        <>
          <span className="ro-badge act-secondary">
            <span className="btn-label">Shared · read-only</span>
          </span>
          <button className="primary-btn" onClick={fork} title="Fork & edit">
            <Icon name="copy" size={18} /> <span className="btn-label">Fork &amp; edit</span>
          </button>
        </>
      ) : (
        <>
          <IconButton
            icon="undo"
            onClick={undo}
            disabled={!canUndo}
            label={`Undo (${MOD_LABEL}+Z)`}
          />
          <span className="act-secondary">
            <IconButton
              icon="redo"
              onClick={redo}
              disabled={!canRedo}
              label={`Redo (${MOD_LABEL}+Shift+Z)`}
            />
          </span>
          <span className="act-secondary">
            <ExportSplitButton />
          </span>
          <span className="act-secondary">
            <button className="primary-btn" onClick={() => openDialog('share')} title="Share">
              <Icon name="share" size={18} /> <span className="btn-label">Share</span>
            </button>
          </span>
        </>
      )}
      <span className="act-overflow">
        <DropdownMenu
          trigger={
            <button type="button" className="mobile-more-btn" aria-label="More actions">
              ⋯
            </button>
          }
        >
          {!readOnly && <DropdownMenuItem onSelect={redo}>Redo</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => openDialog('export')}>Export…</DropdownMenuItem>
          {!readOnly && (
            <DropdownMenuItem onSelect={() => openDialog('share')}>Share…</DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => openDialog('settings')}>Settings…</DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleUi}>Hide UI</DropdownMenuItem>
        </DropdownMenu>
      </span>
    </>
  );
}
