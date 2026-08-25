import type { ReactNode } from 'react';

export type WorkbenchDetent = 'closed' | 'half' | 'full';

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
  applicationNotices?: ReactNode;
}

export type WorkbenchSlots = Omit<WorkspaceSlots, 'applicationNotices'>;

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
