import { useEditor, useEditorStore } from '../editor/EditorProvider';
import { exportSystemJson } from '../share/jsonExport';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from './DropdownMenu';
import { Icon } from './Icon';
import { useUi } from './UiProvider';

/** Figma-style application menu: whole-document actions plus project identity,
 *  tucked behind one trigger in
 *  the left panel instead of sitting loose among the top bar's action
 *  buttons — these are whole-document actions, not in-place edits.
 *  Icon-only trigger, no "TransitMapper" wordmark: the brand row's middle
 *  slot belongs to the system name (see TopBarBrand), not the app's own
 *  name, in every state — not just once zen mode collapses it away. */
export function FileMenu() {
  // Mounted the whole session (it's the top-bar brand button), so it must
  // NOT subscribe to `system` — that's a fresh reference on every store
  // mutation (any drag frame, any import batch), which would re-render this
  // on all of them even though nothing here is ever rendered FROM it (it's
  // only read inside the Export click handler, always wanting the latest
  // value anyway). Read it imperatively instead.
  const store = useEditorStore();
  const readOnly = useEditor((s) => s.readOnly);
  const { openDialog, openNewSystemLocation, toggleUi, uiHidden } = useUi();

  return (
    <DropdownMenu
      align="start"
      trigger={
        <button
          type="button"
          className="btn btn-plain app-menu-trigger"
          title="TransitMapper menu"
          aria-label="TransitMapper menu"
        >
          <Icon name="line" size={18} />
          <Icon name="chevronDown" size={12} />
        </button>
      }
    >
      {!readOnly && (
        <>
          <DropdownMenuItem onSelect={() => openNewSystemLocation('create')}>
            <Icon name="file" size={17} /> New system
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog('systems')}>
            <Icon name="layers" size={17} /> My systems…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog('import')}>
            <Icon name="road" size={17} /> Import streets…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog('gtfs')}>
            <Icon name="bus" size={17} /> Import RTC's real system…
          </DropdownMenuItem>
          {/* The portable escape hatch out of browser localStorage (the only
              other place a system lives) — back it up, put it in git, move it
              to another browser/computer. Not the same as Share, which creates
              a hosted read-only snapshot rather than a file you keep. */}
          <DropdownMenuItem onSelect={() => exportSystemJson(store.getState().system)}>
            <Icon name="download" size={17} /> Export system data (.json)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem onSelect={toggleUi}>
        <Icon name={uiHidden ? 'panelOpen' : 'sidebar'} size={17} />
        {uiHidden ? 'Show interface' : 'Hide interface'}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => openDialog('about')}>
        <span className="dropdown-menu-icon-spacer" aria-hidden="true" /> About TransitMapper…
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
