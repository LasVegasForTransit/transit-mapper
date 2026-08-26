import { Fragment, useEffect, useRef } from 'react';
import { useSelectionActions } from '../editor/useSelectionActions';
import { useEditor } from '../editor/EditorProvider';
import { useDocumentView } from '../editor/document-view-controls';
import { useContextMenu } from './UiProvider';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from './DropdownMenu';
import { shouldCloseMapContextMenu } from './mapContextMenuLifecycle';

/**
 * The map's right-click menu: the actions available for what is selected,
 * rendered where the cursor is.
 *
 * The map's pointer code has to tell a right-drag (which pans) from a
 * right-click, so the native popover is anchored to a zero-size element at
 * the accepted click coordinate instead of relying on contextmenu defaults.
 *
 * Only actions that apply are here, because the registry only returns those.
 * The one-line explanation of a near-miss merge belongs to the inspector; a
 * menu that pops up to tell you it has nothing for you is worse than one that
 * shows the one action it does have.
 */
export function MapContextMenu() {
  const { contextMenuAt, closeContextMenu } = useContextMenu();
  const tool = useEditor((state) => state.tool);
  const { viewMode } = useDocumentView();
  const { actions } = useSelectionActions(
    contextMenuAt?.at,
    contextMenuAt?.serviceHit,
    contextMenuAt?.corridorHit,
  );

  // A menu belongs to the tool and projection that opened it. Record those
  // values after opening, then close in effects when the surrounding editor
  // state makes its actions meaningless. Effects avoid setting provider state
  // during render, which React correctly rejects.
  const openedFor = useRef<{
    menu: NonNullable<typeof contextMenuAt>;
    tool: typeof tool;
    viewMode: typeof viewMode;
  } | null>(null);
  const currentToolRef = useRef(tool);
  const currentViewModeRef = useRef(viewMode);
  currentToolRef.current = tool;
  currentViewModeRef.current = viewMode;
  useEffect(() => {
    if (!contextMenuAt) {
      openedFor.current = null;
      return;
    }
    openedFor.current = {
      menu: contextMenuAt,
      tool: currentToolRef.current,
      viewMode: currentViewModeRef.current,
    };
  }, [contextMenuAt]);
  useEffect(() => {
    const opened = openedFor.current;
    if (!contextMenuAt || opened?.menu !== contextMenuAt) return;
    if (
      shouldCloseMapContextMenu({
        actionCount: actions.length,
        openedTool: opened.tool,
        currentTool: tool,
        openedViewMode: opened.viewMode,
        currentViewMode: viewMode,
      })
    )
      closeContextMenu();
  }, [actions.length, closeContextMenu, contextMenuAt, tool, viewMode]);

  if (!contextMenuAt || actions.length === 0) return null;

  let lastGroup = actions[0].group;
  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) closeContextMenu();
      }}
      align="start"
      sideOffset={0}
      trigger={
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          style={{
            position: 'fixed',
            left: contextMenuAt.x,
            top: contextMenuAt.y,
            width: 0,
            height: 0,
            pointerEvents: 'none',
          }}
        />
      }
    >
      {actions.map((action) => {
        const separated = action.group !== lastGroup;
        lastGroup = action.group;
        return (
          <Fragment key={action.id}>
            {separated && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={() => {
                action.run();
                closeContextMenu();
              }}
            >
              {action.label}
            </DropdownMenuItem>
          </Fragment>
        );
      })}
    </DropdownMenu>
  );
}
