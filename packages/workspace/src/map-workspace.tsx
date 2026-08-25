import type { ReactNode } from 'react';
import { Workbench } from './workbench';
import type { WorkspaceActions, WorkspaceSlots, WorkspaceState } from './workspace-slots';

export interface MapWorkspaceProps {
  mapSurface: ReactNode;
  mapOverlay?: ReactNode;
  slots: WorkspaceSlots;
  state: WorkspaceState;
  actions: WorkspaceActions;
}

export function MapWorkspace({ mapSurface, mapOverlay, slots, state, actions }: MapWorkspaceProps) {
  return (
    <div
      className="app workspace-root"
      data-zen={state.chromeHidden || undefined}
      data-document-status={state.contentStatus}
    >
      {mapSurface}
      {mapOverlay}
      <Workbench slots={slots} state={state} actions={actions} />
    </div>
  );
}
