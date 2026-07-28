import * as RdxMenu from '@radix-ui/react-dropdown-menu';
import { useSelectionActions } from '../editor/useSelectionActions';
import { useContextMenu } from './UiProvider';

/**
 * The map's right-click menu: the actions available for what is selected,
 * rendered where the cursor is.
 *
 * Built on Radix's DropdownMenu rather than its ContextMenu because the
 * gesture that opens this is not a plain DOM contextmenu event — the map's
 * pointer code has to tell a right-DRAG (which pans) from a right-CLICK, and
 * only the latter opens a menu. So the trigger is a zero-size element parked
 * at the cursor and the open state is controlled from outside. Positioning,
 * collision handling, focus, and arrow-key navigation still come from Radix,
 * the same as DropdownMenu.tsx.
 *
 * Only actions that apply are here, because the registry only returns those.
 * The one-line explanation of a near-miss merge belongs to the inspector; a
 * menu that pops up to tell you it has nothing for you is worse than one that
 * shows the one action it does have.
 */
export function MapContextMenu() {
  const { contextMenuAt, closeContextMenu } = useContextMenu();
  const { actions } = useSelectionActions(contextMenuAt?.at, contextMenuAt?.serviceHit);

  if (!contextMenuAt || actions.length === 0) return null;

  let lastGroup = actions[0].group;
  return (
    <RdxMenu.Root
      open
      onOpenChange={(open) => {
        if (!open) closeContextMenu();
      }}
    >
      <RdxMenu.Trigger
        aria-hidden
        style={{
          position: 'fixed',
          left: contextMenuAt.x,
          top: contextMenuAt.y,
          width: 0,
          height: 0,
          pointerEvents: 'none',
        }}
      />
      <RdxMenu.Portal>
        <RdxMenu.Content className="dropdown-menu-content" align="start" sideOffset={0}>
          {actions.map((action) => {
            const separated = action.group !== lastGroup;
            lastGroup = action.group;
            return (
              <div key={action.id}>
                {separated && <RdxMenu.Separator className="dropdown-menu-separator" />}
                <RdxMenu.Item
                  className="dropdown-menu-item"
                  onSelect={() => {
                    action.run();
                    closeContextMenu();
                  }}
                >
                  {action.label}
                </RdxMenu.Item>
              </div>
            );
          })}
        </RdxMenu.Content>
      </RdxMenu.Portal>
    </RdxMenu.Root>
  );
}
