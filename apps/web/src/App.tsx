import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { MapWorkspace, useMapViewStore } from '@transitmapper/workspace';
import type { RouteIntent } from './app/route-intent';
import { useEditor, useEditorCommands, useEditorStore } from './editor/EditorProvider';
import { resolveEditorBootstrap } from './editor/editor-bootstrap';
import { getMap } from './map/mapRef';
import { EditorMapSurface } from './map/editor-map-surface';
import { useOnlineStatus } from './network/useOnlineStatus';
import { useStartupLifecycle } from './perf/startup-lifecycle';
import { useInstall } from './pwa/InstallProvider';
import { shouldShowInstallBanner } from './pwa/install';
import { saveToLibrary, type SaveOutcome } from './storage/browserLibrary';
import { hasSeenOnboarding, setActiveId } from './storage/localStore';
import {
  attachPersistenceCoordinator,
  type PersistenceCoordinator,
} from './storage/persistenceCoordinator';
import { AppBanner } from './ui/AppBanner';
import {
  resolveAppBanner,
  type AppBannerActionKind,
  type BootstrapOutcome,
  type NoticeCause,
} from './ui/app-banner';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { ImportProgressPill } from './ui/ImportProgressPill';
import { Inspector, useSupplementalContent } from './ui/Inspector';
import { InstallBanner } from './ui/InstallBanner';
import { MapContextMenu } from './ui/MapContextMenu';
import { useSaveStatus } from './ui/SaveStatusProvider';
import { SidebarPanel } from './ui/SidebarPanel';
import { SimControls, SimControlsCompact } from './ui/SimControls';
import { Toolbar } from './ui/Toolbar';
import { TopBarActions, TopBarBrand, ViewSwitch, ViewSwitchCompact } from './ui/TopBar';
import { useUi } from './ui/UiProvider';
import { useView } from './ui/ViewProvider';
import { representationLabel, supplementalDetent } from './ui/workspace-adapter';
import './ui/app.css';
import '@transitmapper/workspace/workbench.css';

// Lazy-loaded: pulls in fflate + the GTFS parsing pipeline (packages/core's
// model/gtfsImport.ts), used nowhere else in the app's eager import graph —
// no reason to ship that in the editor-host chunk for the common case where
// this dialog is never opened. EditorSession already renders it conditionally
// below, which is the shape React.lazy wants.
const GtfsImportDialog = lazy(() =>
  import('./ui/GtfsImportDialog').then((m) => ({ default: m.GtfsImportDialog })),
);
// Same reasoning applied to every other dialog gated behind an explicit user
// action (activeDialog === "..."/shortcutsOpen) rather than rendered on
// initial paint — none of these need to be in the first-paint bundle either.
const ExportDialog = lazy(() =>
  import('./ui/ExportDialog').then((m) => ({ default: m.ExportDialog })),
);
const ImportDialog = lazy(() =>
  import('./ui/ImportDialog').then((m) => ({ default: m.ImportDialog })),
);
const ShareDialog = lazy(() =>
  import('./ui/ShareDialog').then((m) => ({ default: m.ShareDialog })),
);
const ShortcutsDialog = lazy(() =>
  import('./ui/ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog })),
);
const SystemsDialog = lazy(() =>
  import('./ui/SystemsDialog').then((m) => ({ default: m.SystemsDialog })),
);
const SettingsDialog = lazy(() =>
  import('./ui/SettingsDialog').then((m) => ({ default: m.SettingsDialog })),
);
const FirstRunDialogs = lazy(() =>
  import('./ui/onboarding/first-run-dialogs').then((module) => ({
    default: module.FirstRunDialogs,
  })),
);
const AboutDialog = lazy(() =>
  import('./ui/about-dialog').then((m) => ({ default: m.AboutDialog })),
);

/** How long a document may take to arrive before the silence is worth
 *  explaining. Long enough that a healthy local read never trips it, short
 *  enough that a stalled one doesn't leave someone guessing. */
const SLOW_LOAD_NOTICE_MS = 1_000;

// Every message this app can show, and the order it shows them in, lives in
// ui/appBanner.ts. What reaches state here is the *cause* — see NoticeCause.

interface LazyDialogProps {
  children: ReactNode;
  /** Runs when the chunk fails to load, so the dialog that can't render stops
   *  occupying the screen and the reason is reported somewhere visible. */
  onFailure: () => void;
}

/**
 * Every dialog is a separately-hashed `lazy()` chunk, which means every dialog
 * is a network request that can fail — most reliably right after a deploy,
 * when an already-open tab asks for a filename that no longer exists. A bare
 * `Suspense` has no answer for a rejected import: the rejection propagates
 * past it and unmounts the whole app, taking the user's unsaved system with
 * it. The boundary is what turns that into a closed dialog and a sentence.
 */
function LazyDialog({ children, onFailure }: LazyDialogProps) {
  return (
    <ErrorBoundary label="dialog" onError={onFailure}>
      <Suspense
        fallback={
          <>
            <div className="modal-backdrop" aria-hidden="true" />
            <div
              className="modal lazy-dialog-loading"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <span className="import-progress-spinner" aria-hidden="true" />
              Loading dialog…
            </div>
          </>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

interface EditorSessionProps {
  routeIntent: RouteIntent;
}

export function EditorSession({ routeIntent }: EditorSessionProps) {
  const store = useEditorStore();
  const mapViewStore = useMapViewStore();
  const {
    document: { newSystem, setSystem },
    selection: { select: clearSelection },
    tools: { setDraftMode, setTool },
  } = useEditorCommands();
  const {
    shortcutsOpen,
    closeShortcuts,
    uiHidden,
    toggleUi,
    activeDialog,
    openDialog,
    closeDialog,
    newSystemLocationMode,
    openNewSystemLocation,
  } = useUi();
  const { viewMode } = useView();
  // Whether the document on screen is the one the app went looking for. Owned
  // by the store, because that is where it decides which changes to accept —
  // mirroring it into local state here would let the two disagree.
  const documentStatus = useEditor((s) => s.documentStatus);
  const [slowToLoad, setSlowToLoad] = useState(false);
  // Why bootstrap produced no document, and nothing else. What it produced is
  // the store's business; keeping the two apart means neither can contradict
  // the other, which is what the pair of booleans this replaced could do.
  const [bootstrap, setBootstrap] = useState<BootstrapOutcome>({ kind: 'ok' });
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  // Something that already happened and is worth reading once: a stored system
  // that wouldn't parse, a dialog that failed to load. Held as a cause rather
  // than as the sentence for it, so the wording stays a render-time decision.
  const [notice, setNotice] = useState<NoticeCause | null>(null);
  // Whether the working copy is actually reaching disk. Held in a provider
  // rather than here because writes happen in dialogs too, and a failure
  // there is exactly as silent and exactly as costly.
  const { outcome: saveState, report } = useSaveStatus();
  // Only ever used to explain a failure that already happened — see
  // network/useOnlineStatus for why the "online" direction is never acted on.
  const online = useOnlineStatus();
  const { installState, recordUndoableEdit, setEditable } = useInstall();

  // Bootstrap resolves the accepted route once. This host applies the outcome
  // only while this mounted editor session still owns the request.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const outcome = await resolveEditorBootstrap(routeIntent, controller.signal);
      if (outcome.kind === 'aborted') return;
      if (outcome.kind === 'share-failed') {
        setBootstrap({ kind: 'share-failed' });
        return;
      }
      if (outcome.kind === 'storage-unavailable') {
        // Do not create a blank replacement or change activeId. IndexedDB may
        // contain the only copy of an agency-scale document and recover on
        // the next attempt.
        setBootstrap({ kind: 'storage-unavailable' });
        return;
      }
      if (outcome.source === 'shared-system') {
        setSystem(outcome.system, { readOnly: true });
        return;
      }
      const { system, isBrandNew } = outcome;
      // The user got here first — they took the "Start a new system" way out
      // of a failed attempt, and this attempt then succeeded. Their document
      // stays. Replacing what somebody is already working in would be the same
      // theft the loading guard exists to prevent, only later and with more
      // work lost, so the saved one is named rather than installed.
      if (store.getState().documentStatus === 'ready') {
        setBootstrap({ kind: 'ok' });
        setNotice('saved-system-arrived');
        return;
      }
      if (outcome.encounteredCorruption) setNotice('corrupt-system');
      // A loaded system is already durable, and legacy reads migrate as part
      // of loading. Only a genuinely new document needs a bootstrap write;
      // rewriting an RTC-sized system here would delay first paint for no
      // additional safety.
      if (isBrandNew) report(await saveToLibrary(system));
      if (controller.signal.aborted) return;
      setBootstrap({ kind: 'ok' });
      setActiveId(system.id);
      setSystem(system, { readOnly: false });
      if (isBrandNew) setTool('way');
      // isBrandNew means "no saved system found" — true for a genuine first
      // run AND for a returning user who deleted their only system, and
      // either way the blank system this bootstrap just created is the best
      // moment to offer real streets instead of an empty canvas. The dialog
      // chains onboarding itself once it closes (see its onClose below),
      // rather than opening both here — only one modal slot exists, and this
      // is also how a returning user who's already seen onboarding avoids
      // seeing it again (the chain checks hasSeenOnboarding, not isBrandNew).
      if (isBrandNew) openNewSystemLocation('importIntoActive');
      else if (!hasSeenOnboarding()) openDialog('onboarding');
    })();
    return () => controller.abort();
  }, [
    store,
    report,
    openDialog,
    openNewSystemLocation,
    bootstrapAttempt,
    routeIntent,
    setSystem,
    setTool,
  ]);

  // A wait nobody noticed does not need announcing, and a message that flashes
  // for 40ms on every single load is worse than silence. Only a wait somebody
  // has begun to feel earns a sentence.
  useEffect(() => {
    if (documentStatus === 'ready') {
      setSlowToLoad(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowToLoad(true), SLOW_LOAD_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [documentStatus, bootstrapAttempt]);

  // Content and camera changes share one debounce/write lane. A pan that lands
  // next to an edit therefore serializes the document once, not once for each
  // source of state; pagehide and update reloads flush this same pending value.
  //
  // Held back until a real document is on screen. The coordinator queues on
  // camera changes as well as content, so attaching it to the placeholder
  // would write an empty system into the library under its own fresh id the
  // first time anyone panned the map — while the real one was still loading.
  const persistence = useRef<PersistenceCoordinator | null>(null);
  useEffect(() => {
    if (documentStatus !== 'ready') return;
    const coordinator = attachPersistenceCoordinator(store, mapViewStore, report);
    persistence.current = coordinator;
    return () => {
      if (persistence.current === coordinator) persistence.current = null;
      coordinator.detach();
    };
  }, [store, mapViewStore, report, documentStatus]);

  const flushPendingSave = useCallback(
    async (): Promise<SaveOutcome> => (await persistence.current?.flush()) ?? 'saved',
    [],
  );
  const flushBeforeReload = useCallback(async (): Promise<void> => {
    await flushPendingSave();
  }, [flushPendingSave]);
  const recordSaveOutcome = useCallback(
    (id: string, outcome: SaveOutcome) => {
      const coordinator = persistence.current;
      if (coordinator) coordinator.recordOutcome(id, outcome);
      else report(outcome);
    },
    [report],
  );
  const discardPendingSave = useCallback(
    (id: string) => {
      const coordinator = persistence.current;
      if (coordinator) coordinator.discard(id);
      else report('saved');
    },
    [report],
  );

  // Service worker registration + update lifecycle — never wired into
  // embed's own entry point (see vite.config.ts).
  const { needRefresh, offlineReady, offlineReadiness, dismissOfflineReady, reload } =
    useStartupLifecycle(documentStatus === 'ready', flushBeforeReload);

  // Dev-only: expose the map for debugging (the store is exposed by EditorProvider).
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __getMap?: unknown }).__getMap = getMap;
    }
  }, []);

  const readOnly = useEditor((s) => s.readOnly);
  const canUndo = useEditor((s) => s.canUndo);

  useEffect(() => {
    setEditable(!readOnly);
  }, [readOnly, setEditable]);

  useEffect(() => {
    if (canUndo) recordUndoableEdit();
  }, [canUndo, recordUndoableEdit]);
  // The right sidebar is the one dynamic surface for "what's relevant right
  // now". What belongs there, and whether it should take over the mobile
  // sheet, are both decided by useSupplementalContent — not restated here.
  const supplemental = useSupplementalContent();

  const dialogFailed = () => {
    closeDialog();
    setNotice('dialog-failed');
  };

  // Everything app-level and urgent goes through one banner. Which message
  // wins, and what each one says, is decided by resolveAppBanner — a pure
  // function over the state below, so the priority order is covered by tests
  // rather than by whoever last read this file.
  const descriptor = resolveAppBanner({
    save: saveState,
    bootstrap,
    updateWaiting: needRefresh,
    offlineReady,
    offlineReadiness,
    notice,
    documentSlowToLoad: slowToLoad,
    online,
  });
  const runBannerAction = (kind: AppBannerActionKind) => {
    switch (kind) {
      case 'retry-bootstrap':
        setBootstrapAttempt((attempt) => attempt + 1);
        return;
      case 'start-new-system':
        // The way out when storage or a shared link can't be reached. Writing
        // immediately rather than waiting for the first edit: the write is how
        // anyone finds out whether storage is working now, and someone who
        // just chose to start over deserves that answer before they've drawn
        // anything, not after.
        newSystem();
        setBootstrap({ kind: 'ok' });
        setActiveId(store.getState().system.id);
        void saveToLibrary(store.getState().system).then(report);
        return;
      case 'reload':
        void reload();
        return;
      case 'dismiss-offline-ready':
        dismissOfflineReady();
        return;
      case 'dismiss-notice':
        setNotice(null);
        return;
    }
  };
  const banner = descriptor ? <AppBanner banner={descriptor} onAction={runBannerAction} /> : null;
  const installBannerShowing = shouldShowInstallBanner({
    eligible: installState.eligible,
    uiHidden,
    readOnly,
    appNoticeShowing: descriptor !== null,
  });
  const applicationNotices = banner
    ? {
        content: <div className="app-banner-content">{banner}</div>,
        placement: 'centered' as const,
      }
    : installBannerShowing
      ? { content: <InstallBanner />, placement: 'panel-aligned' as const }
      : undefined;

  // There is deliberately no branch here for "not loaded yet". Everything below
  // is already in memory before the first byte is read from storage — the HTML,
  // the chunks, the font, the store's placeholder system — so replacing all of
  // it with a status message withholds something that costs nothing to show,
  // and does so at the moment the app knows least about whether the wait will
  // end. It used to, and the two paths that never finished loading (storage
  // unavailable, a shared link that wouldn't fetch) left the product as a
  // single sentence with one button. Waiting is now a banner over a working
  // editor. See docs/product/explanation/design-principles.md.
  return (
    <>
      <MapWorkspace
        mapSurface={
          <EditorMapSurface
            onBasemapUnavailable={() => setNotice('basemap-unavailable')}
            vehiclePaintingSuspended={activeDialog === 'onboarding'}
          />
        }
        mapOverlay={<MapContextMenu />}
        slots={{
          brand: <TopBarBrand />,
          primaryActions: <TopBarActions />,
          representationControls: <ViewSwitch />,
          compactRepresentationControls: <ViewSwitchCompact />,
          simulationControls: <SimControls />,
          compactSimulationControls: <SimControlsCompact />,
          mainPanel: <SidebarPanel />,
          supplementalPanel: <Inspector />,
          toolDock: <Toolbar />,
          importStatus: <ImportProgressPill />,
          applicationNotices,
        }}
        state={{
          representationLabel: representationLabel(viewMode),
          hasSupplementalContent: supplemental.kind !== 'none',
          initialSupplementalDetent: supplementalDetent(supplemental),
          chromeHidden: uiHidden,
          contentStatus: documentStatus,
        }}
        actions={{
          onToggleInterface: toggleUi,
          onDismissSupplemental: () => {
            clearSelection(null);
            setTool('select');
          },
        }}
      />
      {shortcutsOpen && (
        <LazyDialog
          onFailure={() => {
            closeShortcuts();
            setNotice('dialog-failed');
          }}
        >
          <ShortcutsDialog onClose={closeShortcuts} />
        </LazyDialog>
      )}
      {activeDialog === 'import' && (
        <LazyDialog onFailure={dialogFailed}>
          <ImportDialog onClose={closeDialog} />
        </LazyDialog>
      )}
      {activeDialog === 'gtfs' && (
        <LazyDialog onFailure={dialogFailed}>
          <GtfsImportDialog onClose={closeDialog} />
        </LazyDialog>
      )}
      {activeDialog === 'export' && (
        <LazyDialog onFailure={dialogFailed}>
          <ExportDialog onClose={closeDialog} />
        </LazyDialog>
      )}
      {activeDialog === 'share' && (
        <LazyDialog onFailure={dialogFailed}>
          <ShareDialog onClose={closeDialog} />
        </LazyDialog>
      )}
      {activeDialog === 'systems' && (
        <LazyDialog onFailure={dialogFailed}>
          <SystemsDialog
            onClose={closeDialog}
            onCorrupt={() => setNotice('corrupt-open')}
            flushPendingSave={flushPendingSave}
            recordSaveOutcome={recordSaveOutcome}
            discardPendingSave={discardPendingSave}
          />
        </LazyDialog>
      )}
      {activeDialog === 'settings' && (
        <LazyDialog onFailure={dialogFailed}>
          <SettingsDialog onClose={closeDialog} />
        </LazyDialog>
      )}
      {(activeDialog === 'onboarding' || activeDialog === 'newSystemLocation') && (
        <LazyDialog onFailure={dialogFailed}>
          <FirstRunDialogs
            activeDialog={activeDialog}
            actions={{ setDraftMode, setTool }}
            closeDialog={closeDialog}
            newSystemLocationMode={newSystemLocationMode}
            openDialog={openDialog}
          />
        </LazyDialog>
      )}
      {activeDialog === 'about' && (
        <LazyDialog onFailure={dialogFailed}>
          <AboutDialog onClose={closeDialog} />
        </LazyDialog>
      )}
    </>
  );
}
