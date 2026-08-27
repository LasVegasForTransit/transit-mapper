import { useEditor, useEditorCommands } from '../editor/EditorProvider';
import { useDocumentView, type RepresentationId } from '../editor/document-view-controls';
import { useInertRef } from '@transitmapper/workspace/inert-ref';
import { blurOnEnter } from './formUtils';
import { DropdownMenu, DropdownMenuChoice, DropdownMenuItem } from './DropdownMenu';
import { DrivingSidePopover } from './DrivingSidePopover';
import { ExportSplitButton } from './ExportSplitButton';
import { FileMenu } from './FileMenu';
import { IconButton } from './IconButton';
import { LayersPopover } from './LayersPopover';
import { SavedViewsAction, SavedViewsMenuItem } from './saved-views-action';
import { useUi } from './UiProvider';
import { Icon } from './Icon';
const VIEW_MODES: { mode: RepresentationId; label: string }[] = [
  { mode: 'network', label: 'Network' },
  { mode: 'infrastructure', label: 'Infrastructure' },
  { mode: 'diagram', label: 'Diagram' },
];

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl';

/** Persistent state of the canvas, not a transient action — kept visually
 *  distinct from TopBarActions' button cluster. Desktop: Workbench's own
 *  viewSwitcher prop. Compact: kept in the workbench rail beside the other
 *  canvas-state controls so document identity retains the top bar.
 *
 *  Unlike sim controls (its neighbour in the top-center of the desktop
 *  row), this DOES collapse in zen mode — self-managed here via
 *  `.zen-collapse-cluster` + `inert` rather than threaded through
 *  Workbench, since it owns its own root element. The class shrinks its width,
 *  so the simulation bar reflows into the freed space. The desktop card
 *  uses `.zen-collapse-bar`; mobile has no card, so this class stays here
 *  on the control rather than moving up to the card. */
export function ViewSwitch() {
  const { viewMode, setViewMode } = useDocumentView();
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

/**
 * The same control where three side-by-side labels do not fit: one button
 * wearing the current view's name, opening the same three choices.
 *
 * Not a phone special case — Workbench picks this the moment the top row is
 * narrower than the segmented control needs, which is anything under about
 * 1090px. Before it existed the segmented control simply overflowed its bar,
 * and because `.top-app-bar` scrolls with no scrollbar the overflow was
 * silent: at 768px "Diagram" rendered 0 of its 63px and there was no way to
 * reach the Diagram view at all, on iPad in either orientation and on any
 * phone held sideways.
 *
 * A button rather than a narrower segmented control because the label is
 * what the segmented control was mostly for — it answers "which view am I
 * in" without being read as three choices you have room to compare. The
 * second tap it costs buys back roughly 180px of a 390px bar, and picking a
 * view is something you do once and then work inside.
 */
export function ViewSwitchCompact() {
  const { viewMode, setViewMode } = useDocumentView();
  const { uiHidden } = useUi();
  const ref = useInertRef<HTMLDivElement>(uiHidden);
  const current = VIEW_MODES.find((v) => v.mode === viewMode) ?? VIEW_MODES[0];
  return (
    <div ref={ref} className="zen-collapse-cluster">
      <DropdownMenu
        align="start"
        trigger={
          <button type="button" className="view-switch-btn" aria-label={`View: ${current.label}`}>
            <span className="view-switch-label">{current.label}</span>
            <Icon name="chevronDown" size={14} />
          </button>
        }
      >
        {VIEW_MODES.map((v) => (
          <DropdownMenuChoice
            key={v.mode}
            checked={v.mode === viewMode}
            onSelect={() => setViewMode(v.mode)}
          >
            {v.label}
          </DropdownMenuChoice>
        ))}
      </DropdownMenu>
    </div>
  );
}

/** App menu/system-name — Workbench's own brand prop, rendered
 *  into the menu panel's header on desktop (a floating card up here right
 *  above another one read as an overlap, not two panels) and into the top
 *  bar on mobile instead, where the menu panel is a bottom sheet with
 *  nowhere to put a header. See Workbench.tsx's own comment. */
export function TopBarBrand() {
  const name = useEditor((s) => s.system.name);
  const { setName } = useEditorCommands().document;
  // The store holds a blank placeholder until the saved document arrives, and
  // that placeholder has a name — "Untitled system". Showing it would put a
  // real-looking name on a document that is not the one being opened, and the
  // field would be dead anyway, since the store refuses content changes while
  // it waits. An empty, disabled field says the same thing without asserting
  // something false, and it is the same width either way, so nothing shifts.
  const loading = useEditor((s) => s.documentStatus) === 'loading';
  return (
    <>
      {/* One row, always: FileMenu icon at the left, the system name filling
          the middle, the toggle fixed at
          the right — never three lines, never a wrap. FileMenu's own
          "TransitMapper" wordmark doesn't render here at all (see
          FileMenu.tsx) — the middle of this row is the system name's
          permanently, not the app's own name conditionally collapsing
          into it. */}
      <FileMenu />
      <input
        className="system-name"
        value={loading ? '' : name}
        disabled={loading}
        aria-label="System name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={blurOnEnter}
      />
    </>
  );
}

/**
 * The transient-action button cluster — one markup for every viewport.
 * Which subset shows is a LAYOUT decision made by the container: a
 * `.actions-full` container (desktop card) shows as much as it has room for
 * on one line, stepping down through `[data-fit]` — everything, then the
 * same buttons without their labels, then the primary few plus the ⋯
 * overflow (Workbench's useToolbarFit measures which); a
 * `.actions-collapsed` container (mobile's vertical column) shows only the
 * primary few plus ⋯ unconditionally. Same component, same handlers, no
 * per-device behavior forks.
 *
 * Two classes mark what a container may take away, and everything either one
 * marks also appears in the ⋯ menu at the bottom — that menu is where those
 * actions live once the container runs out of room. `.act-tertiary` is help,
 * reached far more often from the keyboard or from a menu than from here;
 * `.act-secondary` is everything else that can go. The help buttons carry
 * BOTH, and need to: `.act-tertiary` is what the desktop bar drops one step
 * early, and `.act-secondary` is the only one mobile's single rule reads.
 *
 * Three buttons carry neither class and are always present: the issues badge,
 * a warning light that only renders when something is actually wrong; layers;
 * and undo. Driving side is unmarked because a verb menu cannot represent a document setting.
 */
export function TopBarActions() {
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const {
    history: { undo, redo },
  } = useEditorCommands();
  const { openShortcuts, openDialog, toggleUi } = useUi();

  return (
    <>
      <LayersPopover />
      <DrivingSidePopover />
      <span className="act-tertiary act-secondary">
        <IconButton icon="keyboard" onClick={openShortcuts} label="Keyboard shortcuts (?)" />
      </span>
      <span className="act-tertiary act-secondary">
        <IconButton icon="play" onClick={() => openDialog('onboarding')} label="Replay intro" />
      </span>
      <IconButton icon="undo" onClick={undo} disabled={!canUndo} label={`Undo (${MOD_LABEL}+Z)`} />
      <span className="act-secondary">
        <IconButton
          icon="redo"
          onClick={redo}
          disabled={!canRedo}
          label={`Redo (${MOD_LABEL}+Shift+Z)`}
        />
      </span>
      <SavedViewsAction onOpen={() => openDialog('savedViews')} />
      <span className="act-secondary">
        <ExportSplitButton />
      </span>
      <span className="act-secondary">
        <button className="primary-btn" onClick={() => openDialog('share')} title="Share">
          <Icon name="share" size={18} /> <span className="btn-label">Share</span>
        </button>
      </span>
      <span className="act-overflow">
        <DropdownMenu
          trigger={
            <button type="button" className="mobile-more-btn" aria-label="More actions">
              ⋯
            </button>
          }
        >
          <DropdownMenuItem onSelect={redo}>Redo</DropdownMenuItem>
          <SavedViewsMenuItem onOpen={() => openDialog('savedViews')} />
          <DropdownMenuItem onSelect={() => openDialog('export')}>Export…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog('share')}>Share…</DropdownMenuItem>
          <DropdownMenuItem onSelect={openShortcuts}>Keyboard shortcuts</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog('onboarding')}>
            Replay intro
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog('settings')}>Settings…</DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleUi}>Hide UI</DropdownMenuItem>
        </DropdownMenu>
      </span>
    </>
  );
}
