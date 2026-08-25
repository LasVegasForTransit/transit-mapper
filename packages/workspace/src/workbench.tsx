import { useEffect, useRef, useState } from 'react';
import { ChromeIcon } from './chrome-icon';
import { useInertRef } from './inert-ref';
import { useKeyboardInset } from './keyboard-inset';
import { useCompactLayout, useMediaQuery } from './media-query';
import { MenuCard } from './menu-card';
import { SheetHandle } from './sheet-handle';
import { useToolbarFit } from './toolbar-fit';
import type {
  WorkbenchDetent,
  WorkbenchSlots,
  WorkspaceActions,
  WorkspaceState,
} from './workspace-slots';

const ROOMY_TOP_ROW_QUERY = '(min-width: 1089px)';

export interface WorkbenchProps {
  slots: WorkbenchSlots;
  state: WorkspaceState;
  actions: WorkspaceActions;
}

interface DesktopWorkbenchProps extends WorkbenchProps {
  compactTopRow: boolean;
}

function DesktopWorkbench({ slots, state, actions, compactTopRow }: DesktopWorkbenchProps) {
  const representationControls = compactTopRow
    ? slots.compactRepresentationControls
    : slots.representationControls;
  const supplementalRef = useInertRef<HTMLDivElement>(state.chromeHidden);
  const fullActionsRef = useInertRef<HTMLDivElement>(state.chromeHidden);
  const actionsSlotRef = useRef<HTMLDivElement | null>(null);
  const toolbarFit = useToolbarFit(actionsSlotRef, fullActionsRef, false);

  return (
    <>
      <div className="workspace-menu-card-slot">
        <MenuCard
          brand={slots.brand}
          chromeHidden={state.chromeHidden}
          representationLabel={state.representationLabel}
          onToggleInterface={actions.onToggleInterface}
        >
          {slots.mainPanel}
        </MenuCard>
      </div>
      {state.hasSupplementalContent && (
        <div ref={supplementalRef} className="workspace-supplemental zen-cluster">
          {slots.supplementalPanel}
        </div>
      )}

      <div className="workspace-top-row">
        <div className="workspace-top-row-spacer" aria-hidden="true" />
        <div className="workspace-top-card top-app-bar top-app-bar-center top-chrome-card zen-collapse-bar">
          {representationControls}
        </div>
        <div className="workspace-top-card top-app-bar top-app-bar-center top-chrome-card">
          {compactTopRow ? slots.compactSimulationControls : slots.simulationControls}
        </div>
        <div ref={actionsSlotRef} className="workspace-actions-slot">
          <div
            ref={fullActionsRef}
            data-fit={toolbarFit}
            className="workspace-top-card actions-full top-app-bar top-app-bar-end top-chrome-card zen-cluster"
          >
            {slots.primaryActions}
          </div>
        </div>
      </div>

      <div className="workspace-dock-slot dock-slot">
        {slots.importStatus && <div className="workspace-interactive">{slots.importStatus}</div>}
        <div className="workspace-interactive">{slots.toolDock}</div>
      </div>
    </>
  );
}

function CompactWorkbench({ slots, state, actions }: WorkbenchProps) {
  const [detent, setDetent] = useState<WorkbenchDetent>(
    state.initialSupplementalDetent ?? 'closed',
  );
  const keyboardInset = useKeyboardInset();
  const collapsedActionsRef = useInertRef<HTMLDivElement>(state.chromeHidden);
  const sheetRef = useInertRef<HTMLDivElement>(state.chromeHidden);

  useEffect(() => {
    if (state.hasSupplementalContent && state.initialSupplementalDetent) {
      setDetent(state.initialSupplementalDetent);
    }
  }, [state.hasSupplementalContent, state.initialSupplementalDetent]);

  return (
    <>
      <div className="compact-top-bar zen-cluster" ref={collapsedActionsRef}>
        <div className="compact-top-bar-row">
          {slots.brand}
          <div className="actions-collapsed">{slots.primaryActions}</div>
        </div>
      </div>
      {state.chromeHidden && (
        <button
          type="button"
          className="zen-restore"
          onClick={actions.onToggleInterface}
          aria-label="Show UI (\)"
        >
          <ChromeIcon name="sidebar" />
        </button>
      )}
      <div
        ref={sheetRef}
        style={{
          bottom: keyboardInset > 0 ? keyboardInset : undefined,
          paddingBottom: keyboardInset > 0 ? undefined : 'env(safe-area-inset-bottom, 0px)',
        }}
        className={`compact-workbench ${state.chromeHidden ? 'is-hidden' : `is-${detent}`}`}
      >
        <SheetHandle
          detent={detent}
          setDetent={setDetent}
          title={state.hasSupplementalContent ? 'Details' : state.representationLabel}
        />
        {state.hasSupplementalContent && (
          <button type="button" className="sheet-back" onClick={actions.onDismissSupplemental}>
            <ChromeIcon name="chevronDown" size={15} style={{ transform: 'rotate(90deg)' }} />{' '}
            {state.representationLabel}
          </button>
        )}
        <div className="workbench-panel">
          {state.hasSupplementalContent ? slots.supplementalPanel : slots.mainPanel}
        </div>
        {slots.importStatus && <div className="workbench-status">{slots.importStatus}</div>}
        <div className="workbench-rail zen-cluster">
          <div className="workbench-rail-state">
            {slots.compactRepresentationControls}
            <div className="workbench-rail-sim">{slots.compactSimulationControls}</div>
          </div>
          {slots.toolDock}
        </div>
      </div>
    </>
  );
}

export function Workbench(props: WorkbenchProps) {
  const compact = useCompactLayout();
  const roomyTopRow = useMediaQuery(ROOMY_TOP_ROW_QUERY);

  return (
    <div className="workspace-overlay" data-workbench>
      {props.slots.applicationNotices && (
        <div
          className={`workspace-application-notice is-${props.slots.applicationNotices.placement}`}
        >
          {props.slots.applicationNotices.content}
        </div>
      )}
      {compact ? (
        <CompactWorkbench {...props} />
      ) : (
        <DesktopWorkbench {...props} compactTopRow={!roomyTopRow} />
      )}
    </div>
  );
}
