import { useEditorStore } from '../editor/EditorProvider';
import { useDocumentView } from '../editor/document-view-controls';
import { exportQuickSystem, preloadQuickExport } from '../share/quick-export';
import { DropdownMenu, DropdownMenuItem } from './DropdownMenu';
import { Icon } from './Icon';
import { useUi } from './UiProvider';

/** MD3 split (compound) button: the main segment opens the full export
 *  dialog (format + view + layer-visibility settings); the trailing caret
 *  opens a quick menu for the common case — export the current view as-is,
 *  no dialog. */
export function ExportSplitButton() {
  // Always mounted (top-bar primary toolbar) — read `system` imperatively
  // instead of subscribing, same reasoning as FileMenu: it's only used
  // inside quickExport's click handler, never rendered, so subscribing would
  // just re-render this on every store mutation for no visible benefit.
  const store = useEditorStore();
  const { viewMode, visibleModes, visibleWayTypes } = useDocumentView();
  const { openDialog } = useUi();

  const quickExport = (format: 'png' | 'svg') => {
    const system = store.getState().system;
    const filename = `${system.name || 'transit-system'}.${format}`;
    const view = { viewMode, visibleModes, visibleWayTypes };
    // Quick export still shows the whole system (fits bounds, titles, and
    // legends itself) rather than just whatever's currently on screen. The
    // runtime was preloaded on a deliberate menu intent where possible.
    void exportQuickSystem(format, system, view, filename);
  };

  return (
    <div className="split-btn-root">
      {/* aria-label on the main button, not just a title: .btn-label is
          hidden below 620px, which leaves it icon-only with no accessible
          name at exactly the widths most likely to be a touchscreen, where
          a title tooltip is unreachable anyway. */}
      <div className="split-btn">
        <button
          type="button"
          className="split-btn-main"
          onClick={() => openDialog('export')}
          title="Export…"
          aria-label="Export"
        >
          <Icon name="download" size={18} /> <span className="btn-label">Export</span>
        </button>
        <DropdownMenu
          trigger={
            <button
              type="button"
              className="split-btn-caret"
              title="Quick export"
              aria-label="Quick export options"
              onPointerDown={preloadQuickExport}
              onFocus={preloadQuickExport}
            >
              <Icon name="chevronDown" size={15} />
            </button>
          }
        >
          <DropdownMenuItem onSelect={() => quickExport('png')}>Export PNG</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => quickExport('svg')}>Export SVG</DropdownMenuItem>
        </DropdownMenu>
      </div>
    </div>
  );
}
