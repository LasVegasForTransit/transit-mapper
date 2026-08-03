import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { MapCanvas } from './map/MapCanvas';
import { getMap } from './map/mapRef';
import { useEditor, useEditorStore } from './editor/EditorProvider';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { fetchShare } from './share/api';
import {
  listLibrary,
  loadSystemEntry,
  migrateLegacySingleSlot,
  saveToLibrary,
  type SaveOutcome,
} from './storage/browserLibrary';
import {
  getActiveId,
  hasSeenOnboarding,
  markOnboardingSeen,
  setActiveId,
} from './storage/localStore';
import {
  attachPersistenceCoordinator,
  type PersistenceCoordinator,
} from './storage/persistenceCoordinator';
import { resolveLibraryBootstrap } from './storage/bootstrapLibrary';
import { Icon } from './ui/Icon';
import { ImportProgressPill } from './ui/ImportProgressPill';
import { MapContextMenu } from './ui/MapContextMenu';
import { Inspector, useShowingToolDraft } from './ui/Inspector';
import { SidebarPanel } from './ui/SidebarPanel';
import { SimControls, SimControlsCompact } from './ui/SimControls';
import { Toolbar } from './ui/Toolbar';
import { TopBarActions, TopBarBrand, ViewSwitch } from './ui/TopBar';
import { useSaveStatus } from './ui/SaveStatusProvider';
import { useUi } from './ui/UiProvider';
import { Workbench } from './ui/Workbench';
import { InstallBanner } from './ui/InstallBanner';
import { useInstall } from './pwa/InstallProvider';
import { shouldShowInstallBanner } from './pwa/install';
import { useAppUpdate } from '@transitmapper/pwa-updater/useAppUpdate';
import './ui/app.css';

// Lazy-loaded: pulls in fflate + the GTFS parsing pipeline (packages/core's
// model/gtfsImport.ts), used nowhere else in the app's eager import graph —
// no reason to ship that in the main bundle for the common case where this
// dialog is never opened. App already renders it conditionally below, the
// shape React.lazy wants.
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
const OnboardingDialog = lazy(() =>
  import('./ui/onboarding/OnboardingDialog').then((m) => ({ default: m.OnboardingDialog })),
);

const SHARE_PREFIX = '/s/';

// The common case by far is a chunk whose filename changed under a tab that
// was left open, so "reload" is the actual fix rather than a shrug.
const dialogFailureNotice =
  'That dialog couldn’t be loaded. Your system is safe — reload the page and try again.';

// Says what still works, because most of it does: the basemap is a backdrop
// from a third-party host, and everything the user has drawn is ours.
const basemapNotice =
  'The background map couldn’t be loaded, so the map behind your system is blank. Your system is unaffected and still saved.';

// Deliberately says the damaged copy still exists. "Your work is gone" and
// "your work is here but unreadable" call for very different reactions, and
// only one of them is true.
const corruptSystemNotice =
  'The system you had open couldn’t be read, so this is a new one. The damaged copy is still saved and hasn’t been deleted.';

// Same condition reached deliberately rather than at startup — the user
// clicked a row and deserves to know why nothing happened.
const corruptOpenNotice =
  'That system couldn’t be read, so it can’t be opened. Its data is still saved and hasn’t been deleted.';

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

export function App() {
  const store = useEditorStore();
  const { shortcutsOpen, closeShortcuts, uiHidden, activeDialog, openDialog, closeDialog } =
    useUi();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storageRecovery, setStorageRecovery] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  // Anything worth telling the user that isn't the share-load error: a stored
  // system that wouldn't parse, a dialog that failed to load.
  const [notice, setNotice] = useState<string | null>(null);
  // Whether the working copy is actually reaching disk. Held in a provider
  // rather than here because writes happen in dialogs too, and a failure
  // there is exactly as silent and exactly as costly.
  const { outcome: saveState, report } = useSaveStatus();
  const { installState, recordUndoableEdit, setEditable } = useInstall();

  // Bootstrap: shared link → read-only load; otherwise local autosave or fresh.
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith(SHARE_PREFIX)) {
      const controller = new AbortController();
      const id = path.slice(SHARE_PREFIX.length).replace(/\/$/, '');
      fetchShare(id, { signal: controller.signal })
        .then((system) => store.getState().setSystem(system, { readOnly: true }))
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setLoadError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setReady(true);
        });
      return () => controller.abort();
    }
    // Load whichever system was last open; migrate the old single-slot
    // autosave if this is the first run since the library existed; fall back
    // to any saved system if the active-id pointer is stale; otherwise start
    // a brand-new one (and only then default the tool to Way, matching the
    // very first run's old behavior).
    //
    // A record that exists but won't parse is called out rather than skipped.
    // Falling through to a fresh empty system is the right *recovery* — there
    // is nothing else to show — but doing it silently means the user opens the
    // app to a blank canvas and concludes their work is gone. The bytes are
    // still in storage; saying so is the difference between a bug report we
    // can act on and someone quietly leaving.
    let disposed = false;
    void (async () => {
      const result = await resolveLibraryBootstrap({
        activeId: getActiveId(),
        library: {
          load: loadSystemEntry,
          list: listLibrary,
          migrateLegacySingleSlot,
        },
        createSystem: createEmptySystem,
      });
      if (disposed) return;
      if (result.status === 'unavailable') {
        // Do not create a blank replacement or change activeId. IndexedDB may
        // contain the only copy of an agency-scale document and recover on
        // the next attempt.
        setStorageRecovery(true);
        setReady(false);
        return;
      }
      const { system, isBrandNew } = result;
      if (result.encounteredCorruption) setNotice(corruptSystemNotice);
      // A loaded system is already durable, and legacy reads migrate as part
      // of loading. Only a genuinely new document needs a bootstrap write;
      // rewriting an RTC-sized system here would delay first paint for no
      // additional safety.
      if (isBrandNew) report(await saveToLibrary(system));
      if (disposed) return;
      setStorageRecovery(false);
      setActiveId(system.id);
      store.getState().setSystem(system, { readOnly: false });
      if (isBrandNew) store.getState().setTool('way');
      // Independent of isBrandNew: that flag means "no saved system found,"
      // which a returning user hits too (they deleted their only system) —
      // conflating the two would re-show onboarding to someone who's seen it.
      if (!hasSeenOnboarding()) openDialog('onboarding');
      setReady(true);
    })();
    return () => {
      disposed = true;
    };
  }, [store, report, openDialog, bootstrapAttempt]);

  // Content and camera changes share one debounce/write lane. A pan that lands
  // next to an edit therefore serializes the document once, not once for each
  // source of state; pagehide and update reloads flush this same pending value.
  const persistence = useRef<PersistenceCoordinator | null>(null);
  useEffect(() => {
    if (!ready) return;
    const coordinator = attachPersistenceCoordinator(store, report);
    persistence.current = coordinator;
    return () => {
      if (persistence.current === coordinator) persistence.current = null;
      coordinator.detach();
    };
  }, [store, report, ready]);

  const flushPendingSave = useCallback(() => persistence.current?.flush(), []);
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
  const { needRefresh, offlineReady, dismissOfflineReady, reload } = useAppUpdate(flushPendingSave);

  // Dev-only: expose the map for debugging (the store is exposed by EditorProvider).
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __getMap?: unknown }).__getMap = getMap;
    }
  }, []);

  const selection = useEditor((s) => s.selection);
  const multiSelection = useEditor((s) => s.multiSelection);
  const readOnly = useEditor((s) => s.readOnly);
  const tool = useEditor((s) => s.tool);
  const canUndo = useEditor((s) => s.canUndo);

  useEffect(() => {
    setEditable(!readOnly);
  }, [readOnly, setEditable]);

  useEffect(() => {
    if (canUndo) recordUndoableEdit();
  }, [canUndo, recordUndoableEdit]);
  // The right sidebar is the one dynamic surface for "what's relevant right
  // now" — a selected object's details, OR (when a drawing tool is armed)
  // that tool's own draft options, never a second bottom-bar popup for the
  // latter. Diagram/read-only both disable drawing tools outright (see
  // Toolbar's own `locked`), so an armed tool from before switching there
  // shouldn't still claim this slot.
  const showingToolDraft = useShowingToolDraft();
  const hasSupplementalContent =
    selection !== null || multiSelection.length > 0 || showingToolDraft;
  // A selection or a picked-up drawing tool is something the person just did,
  // so the mobile sheet opens for it. The Select tool's standing modifier
  // channels are not, and must not park the sheet over the map on load.
  const supplementalIsFresh =
    selection !== null || multiSelection.length > 0 || (showingToolDraft && tool !== 'select');

  const dialogFailed = () => {
    closeDialog();
    setNotice(dialogFailureNotice);
  };

  // Everything app-level and urgent goes through the one banner below.
  // A failing autosave outranks the others: the other two describe something
  // that already happened, this one is still happening and gets worse the
  // longer it goes unread.
  const saveMessage =
    saveState === 'full'
      ? 'Your browser’s storage is full, so your work is no longer being saved. Export this system, or delete one you don’t need, to make room.'
      : saveState === 'unavailable'
        ? 'This browser isn’t saving your work — storage is unavailable here, which private browsing windows often do. Export before closing the tab.'
        : null;
  const banner = saveMessage ? (
    <div className="app-banner" role="alert">
      {saveMessage}
    </div>
  ) : storageRecovery ? (
    <div className="app-banner app-banner-action" role="alert">
      <span>
        Your saved systems are temporarily unavailable. Nothing was replaced; retry when browser
        storage is available again.
      </span>
      <button
        type="button"
        className="ghost-btn"
        onClick={() => setBootstrapAttempt((attempt) => attempt + 1)}
      >
        Try again
      </button>
    </div>
  ) : loadError ? (
    <div className="app-banner" role="alert">
      Couldn’t open shared system: {loadError}
    </div>
  ) : needRefresh ? (
    // Not dismissible — reloading is the only way to clear it, and it isn't
    // an error, so it deliberately doesn't borrow app-banner's danger tone.
    <div className="app-banner app-banner-update app-banner-action" role="status">
      <span>A new version of TransitMapper is available.</span>
      <button type="button" className="ghost-btn" onClick={reload}>
        Reload
      </button>
    </div>
  ) : offlineReady ? (
    // Good news, not a problem — same neutral tone as the update banner
    // above, not app-banner-dismissible's danger one. Centered (app-banner-
    // action), not flex-start: that alignment exists for the longer, wrapped
    // messages notice below carries, and looks visibly off on this one-liner.
    <div className="app-banner app-banner-update app-banner-action" role="status">
      <span>TransitMapper is now available offline.</span>
      <button
        type="button"
        className="app-banner-dismiss"
        onClick={dismissOfflineReady}
        aria-label="Dismiss"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  ) : notice ? (
    // Dismissible, unlike the two above. Those describe a condition that is
    // still true — a share that won't load, a save that isn't happening — and
    // clearing them would be a lie. A notice describes something that already
    // happened and has been read, and it sits over a canvas whose entire
    // interaction model is clicking on it, so it must be possible to get rid
    // of it.
    <div className="app-banner app-banner-dismissible" role="status">
      <span>{notice}</span>
      <button
        type="button"
        className="app-banner-dismiss"
        onClick={() => setNotice(null)}
        aria-label="Dismiss"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  ) : null;

  if (!ready) {
    return (
      <div className="app" data-zen={uiHidden || undefined}>
        <div className="absolute inset-x-0 top-3 z-20 flex justify-center px-3">
          <div className="max-w-[560px]">
            {banner ?? (
              <div className="app-banner" role="status" aria-live="polite">
                Opening your saved systems…
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    // data-zen cascades to every opted-in chrome element via CSS attribute
    // selectors (see app.css's "Zen mode" block: .zen-label, .zen-cluster,
    // and friends) — a component becomes zen-aware by adding a class, not
    // by threading uiHidden through props. MapCanvas and the banner below
    // sit under this same root but carry none of those classes, so they're
    // untouched by it.
    <div className="app" data-zen={uiHidden || undefined}>
      {ready && <MapCanvas onBasemapUnavailable={() => setNotice(basemapNotice)} />}
      {/* Outside the chrome, like the banner above: right-clicking still has
          to offer its actions when the UI is hidden, since hiding the panels
          is exactly when the menu is the only way to reach them. */}
      <MapContextMenu />

      {/* Outside the chrome on purpose. This used to live in a Workbench
          slot, which meant hiding the UI with `\` also hid a failing
          autosave — the one message that must never be gated by a
          presentation toggle. Offsets clear the top bar when it's there and
          sit near the top edge when it isn't. */}
      {banner && (
        <div
          className={`pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3 ${
            uiHidden ? 'top-3' : 'top-[136px] md:top-[68px]'
          }`}
        >
          {/* Sized by its content, capped at 560px — not `w-full`. Two of the
              four banners are one-liners, and forcing every one to 560px left
              a short message hugging the left edge with a dead half-card of
              empty space beside it. A long notice still fills 560 and wraps
              there, which is what the cap is for. */}
          <div className="pointer-events-auto max-w-[560px]">{banner}</div>
        </div>
      )}
      <Workbench
        brand={<TopBarBrand />}
        menuPanel={<SidebarPanel />}
        supplementalPanel={<Inspector />}
        hasSupplementalContent={hasSupplementalContent}
        supplementalIsFresh={supplementalIsFresh}
        primaryToolbar={<TopBarActions />}
        viewSwitcher={<ViewSwitch />}
        simControls={<SimControls />}
        simControlsCompact={<SimControlsCompact />}
        modeToolbar={<Toolbar />}
        importStatus={<ImportProgressPill />}
        installBanner={
          shouldShowInstallBanner({
            eligible: installState.eligible,
            uiHidden,
            readOnly,
          }) ? (
            <InstallBanner />
          ) : undefined
        }
      />
      {shortcutsOpen && (
        <LazyDialog
          onFailure={() => {
            closeShortcuts();
            setNotice(dialogFailureNotice);
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
            onCorrupt={() => setNotice(corruptOpenNotice)}
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
      {activeDialog === 'onboarding' && (
        <LazyDialog
          onFailure={() => {
            markOnboardingSeen();
            dialogFailed();
          }}
        >
          <OnboardingDialog
            onClose={() => {
              markOnboardingSeen();
              closeDialog();
            }}
          />
        </LazyDialog>
      )}
    </div>
  );
}
