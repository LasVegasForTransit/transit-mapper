import type { ReactNode } from 'react';

export type WorkbenchDetent = 'closed' | 'half' | 'full';

export interface ApplicationNoticeSlot {
  content: ReactNode;
  placement: 'centered' | 'panel-aligned';
}

export interface WorkspaceSlots {
  brand: ReactNode;
  primaryActions: ReactNode;
  representationControls: ReactNode;
  compactRepresentationControls: ReactNode;
  simulationControls: ReactNode;
  compactSimulationControls: ReactNode;
  mainPanel: ReactNode;
  supplementalPanel: ReactNode;
  toolDock: ReactNode;
  importStatus?: ReactNode;
  applicationNotices?: ApplicationNoticeSlot;
}

export type WorkbenchSlots = WorkspaceSlots;

export interface WorkspaceState {
  representationLabel: string;
  hasSupplementalContent: boolean;
  initialSupplementalDetent: WorkbenchDetent | null;
  chromeHidden: boolean;
  contentStatus: string;
}

export interface WorkspaceActions {
  onToggleInterface: () => void;
  onDismissSupplemental: () => void;
}
