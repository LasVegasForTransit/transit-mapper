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
  const { applicationNotices, ...workbenchSlots } = slots;
  return (
    <div
      className="app"
      data-zen={state.chromeHidden || undefined}
      data-document-status={state.contentStatus}
    >
      {mapSurface}
      {mapOverlay}
      {applicationNotices}
      <Workbench slots={workbenchSlots} state={state} actions={actions} />
    </div>
  );
}
