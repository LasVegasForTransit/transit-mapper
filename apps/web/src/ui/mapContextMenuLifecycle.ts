import type { Tool } from '../editor/store';
import type { DocumentRepresentationId } from '@transitmapper/renderer/presentation';

export interface MapContextMenuLifecycleInput {
  actionCount: number;
  openedTool: Tool;
  currentTool: Tool;
  openedViewMode: DocumentRepresentationId;
  currentViewMode: DocumentRepresentationId;
}

/** A menu is valid only while its actions and the interaction surface that
 * opened it still exist. The component performs the actual close in an effect. */
export function shouldCloseMapContextMenu(input: MapContextMenuLifecycleInput): boolean {
  return (
    input.actionCount === 0 ||
    input.openedTool !== input.currentTool ||
    input.openedViewMode !== input.currentViewMode
  );
}
