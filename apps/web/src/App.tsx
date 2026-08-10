import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { MapCanvas } from './map/MapCanvas';
import { getMap } from './map/mapRef';
import { useEditor, useEditorCommands, useEditorStore } from './editor/EditorProvider';
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
import { AppBanner } from './ui/AppBanner';
import {
  resolveAppBanner,
  type AppBannerActionKind,
  type BootstrapOutcome,
  type NoticeCause,
} from './ui/app-banner';
import { useOnlineStatus } from './network/useOnlineStatus';
import { ImportProgressPill } from './ui/ImportProgressPill';
import { MapContextMenu } from './ui/MapContextMenu';
import { Inspector, useSupplementalContent } from './ui/Inspector';
import { SidebarPanel } from './ui/SidebarPanel';
import { SimControls, SimControlsCompact } from './ui/SimControls';
import { Toolbar } from './ui/Toolbar';
import { TopBarActions, TopBarBrand, ViewSwitch, ViewSwitchCompact } from './ui/TopBar';
import { useSaveStatus } from './ui/SaveStatusProvider';
import { useUi } from './ui/UiProvider';
import { Workbench } from './ui/Workbench';
import { continueFirstRunOnboarding } from './ui/onboarding/first-run';
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
const NewSystemLocationDialog = lazy(() =>
  import('./ui/newSystem/NewSystemLocationDialog').then((m) => ({
    default: m.NewSystemLocationDialog,
  })),
);
const AboutDialog = lazy(() =>
  import('./ui/about-dialog').then((m) => ({ default: m.AboutDialog })),
);

const SHARE_PREFIX = '/s/';

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

export function App() {
  const store = useEditorStore();
  const {
    document: { newSystem, setSystem },
    tools: { setTool },
  } = useEditorCommands();
  const {
    shortcutsOpen,
    closeShortcuts,
    uiHidden,
    activeDialog,
    openDialog,
    closeDialog,
    newSystemLocationMode,
    openNewSystemLocation,
  } = useUi();
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

  // Bootstrap: shared link → read-only load; otherwise local autosave or fresh.
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith(SHARE_PREFIX)) {
      const controller = new AbortController();
      const id = path.slice(SHARE_PREFIX.length).replace(/\/$/, '');
      fetchShare(id, { signal: controller.signal })
        .then((system) => setSystem(system, { readOnly: true }))
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setBootstrap({ kind: 'share-failed' });
        });
      // No "finished" flag to set either way. A share that loads calls
      // setSystem, which is what ends the wait; a share that doesn't leaves the
      // placeholder locked, so an empty canvas can't be mistaken for the shared
      // system — or quietly autosaved into this browser's library as if it were
      // a new one, which is what used to happen.
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
        setBootstrap({ kind: 'storage-unavailable' });
        return;
      }
      const { system, isBrandNew } = result;
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
      if (result.encounteredCorruption) setNotice('corrupt-system');
      // A loaded system is already durable, and legacy reads migrate as part
      // of loading. Only a genuinely new document needs a bootstrap write;
      // rewriting an RTC-sized system here would delay first paint for no
      // additional safety.
      if (isBrandNew) report(await saveToLibrary(system));
      if (disposed) return;
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
    return () => {
      disposed = true;
    };
  }, [store, report, openDialog, openNewSystemLocation, bootstrapAttempt, setSystem, setTool]);

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
    const coordinator = attachPersistenceCoordinator(store, report);
    persistence.current = coordinator;
    return () => {
      if (persistence.current === coordinator) persistence.current = null;
      coordinator.detach();
    };
  }, [store, report, documentStatus]);

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
  const { needRefresh, offlineReady, dismissOfflineReady, reload } =
    useAppUpdate(flushBeforeReload);

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
    // data-zen cascades to every opted-in chrome element via CSS attribute
    // selectors (see app.css's "Zen mode" block: .zen-label, .zen-cluster,
    // and friends) — a component becomes zen-aware by adding a class, not
    // by threading uiHidden through props. MapCanvas and the banner below
    // sit under this same root but carry none of those classes, so they're
    // untouched by it.
    //
    // data-document-status publishes the one thing that is no longer visible
    // from outside now that the shell renders unconditionally: whether what is
    // on screen is the document the app went looking for. Anything driving the
    // editor — the performance harness, most of all — used to get that answer
    // for free, because the chrome did not exist until the document had
    // loaded. Deleting that gate deleted the signal with it, so it is stated
    // here rather than inferred from whichever element happened to appear last.
    <div className="app" data-zen={uiHidden || undefined} data-document-status={documentStatus}>
      {/* Mounted immediately, so the basemap's network round-trip runs
          alongside the storage read instead of queueing behind it. The camera
          starts on the placeholder's viewport and jumps to the real one when
          the document's id changes — see MapCanvas's system subscription. */}
      <MapCanvas onBasemapUnavailable={() => setNotice('basemap-unavailable')} />
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
        // The vertical offset is app.css's, not a Tailwind `md:` pair: it has
        // to clear whichever top chrome is actually mounted, and that is
        // useCompactLayout()'s decision, which asks about height as well as
        // width. `md:` cannot express the height half — a phone in landscape
        // is 844px wide and would take the desktop offset over the compact
        // chrome. Zen mode rides on [data-zen], like every other chrome rule.
        <div className="app-banner-slot pointer-events-none absolute inset-x-0 z-20 flex justify-center px-3">
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
        supplemental={supplemental.kind}
        primaryToolbar={<TopBarActions />}
        viewSwitcher={<ViewSwitch />}
        viewSwitcherCompact={<ViewSwitchCompact />}
        simControls={<SimControls />}
        simControlsCompact={<SimControlsCompact />}
        modeToolbar={<Toolbar />}
        importStatus={<ImportProgressPill />}
        installBanner={
          shouldShowInstallBanner({
            eligible: installState.eligible,
            uiHidden,
            readOnly,
            appNoticeShowing: descriptor !== null,
          }) ? (
            <InstallBanner />
          ) : undefined
        }
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
      {activeDialog === 'onboarding' && (
        <LazyDialog onFailure={dialogFailed}>
          <OnboardingDialog
            onClose={closeDialog}
            onComplete={() => {
              markOnboardingSeen();
              closeDialog();
            }}
          />
        </LazyDialog>
      )}
      {activeDialog === 'newSystemLocation' && (
        <LazyDialog onFailure={dialogFailed}>
          <NewSystemLocationDialog
            onClose={() => {
              closeDialog();
              // Only the bootstrap trigger (mode: 'importIntoActive') should
              // chain into onboarding — the explicit File-menu/Systems-dialog
              // "New system" action (mode: 'create') closes plain.
              continueFirstRunOnboarding({
                mode: newSystemLocationMode,
                hasSeenOnboarding: hasSeenOnboarding(),
                actions: store.getState(),
                openOnboarding: () => openDialog('onboarding'),
              });
            }}
            mode={newSystemLocationMode}
          />
        </LazyDialog>
      )}
      {activeDialog === 'about' && (
        <LazyDialog onFailure={dialogFailed}>
          <AboutDialog onClose={closeDialog} />
        </LazyDialog>
      )}
    </div>
  );
}
