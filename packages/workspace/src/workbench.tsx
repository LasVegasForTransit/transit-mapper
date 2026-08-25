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
    <div
      className="pointer-events-none absolute inset-2 grid gap-2"
      style={{
        gridTemplateColumns: 'auto 1fr auto',
        gridTemplateRows: 'auto auto 1fr var(--controls-clearance)',
      }}
    >
      <div
        className="menu-card-slot pointer-events-auto flex self-stretch justify-self-start"
        style={{ gridArea: '1 / 1 / 5 / 2' }}
      >
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
        <div
          ref={supplementalRef}
          className="zen-cluster pointer-events-auto flex self-stretch justify-self-end"
          style={{ gridArea: '3 / 3 / 4 / 4' }}
        >
          {slots.supplementalPanel}
        </div>
      )}

      <div
        className="pointer-events-none flex items-start gap-2"
        style={{ gridColumn: '1 / -1', gridRow: '1' }}
      >
        <div className="flex-1" style={{ minWidth: 'var(--panel-w)' }} aria-hidden="true" />
        <div className="top-app-bar top-app-bar-center top-chrome-card zen-collapse-bar pointer-events-auto min-w-0">
          {representationControls}
        </div>
        <div className="top-app-bar top-app-bar-center top-chrome-card pointer-events-auto min-w-0">
          {compactTopRow ? slots.compactSimulationControls : slots.simulationControls}
        </div>
        <div ref={actionsSlotRef} className="flex min-w-0 flex-1 justify-end">
          <div
            ref={fullActionsRef}
            data-fit={toolbarFit}
            className="actions-full top-app-bar top-app-bar-end top-chrome-card zen-cluster pointer-events-auto min-w-0"
          >
            {slots.primaryActions}
          </div>
        </div>
      </div>

      <div className="dock-slot pointer-events-none absolute bottom-0 flex flex-col items-center gap-2">
        {slots.importStatus && <div className="pointer-events-auto">{slots.importStatus}</div>}
        <div className="pointer-events-auto">{slots.toolDock}</div>
      </div>
    </div>
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
      <div
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        className="compact-top-bar zen-cluster"
        ref={collapsedActionsRef}
      >
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
        className="pointer-events-none absolute inset-2"
        style={{
          gridTemplateColumns: 'auto 1fr auto',
          gridTemplateRows: 'auto auto 1fr var(--controls-clearance)',
        }}
      />
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
    <div data-workbench>
      {compact ? (
        <CompactWorkbench {...props} />
      ) : (
        <DesktopWorkbench {...props} compactTopRow={!roomyTopRow} />
      )}
    </div>
  );
}
