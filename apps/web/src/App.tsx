import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { MapCanvas } from "./map/MapCanvas";
import { getMap } from "./map/mapRef";
import { useEditor, useEditorStore } from "./editor/EditorProvider";
import { createEmptySystem } from "@transitmapper/core/model/serialize";
import { fetchShare } from "./share/api";
import {
  getActiveId,
  listLibrary,
  loadSystemById,
  loadSystemEntry,
  migrateLegacySingleSlot,
  saveToLibrary,
  setActiveId,
  type SaveOutcome,
} from "./storage/localStore";
import { Icon } from "./ui/Icon";
import { ImportProgressPill } from "./ui/ImportProgressPill";
import { Inspector } from "./ui/Inspector";
import { LinesPanel } from "./ui/LinesPanel";
import { Toolbar } from "./ui/Toolbar";
import { TopBarActions, TopBarBrand, ViewSwitch } from "./ui/TopBar";
import { useDelayedUnmount } from "./ui/useDelayedUnmount";
import { useUi } from "./ui/UiProvider";
import { useView } from "./ui/ViewProvider";
import { Workbench } from "./ui/Workbench";
import "./ui/app.css";

// Lazy-loaded: pulls in fflate + the GTFS parsing pipeline (packages/core's
// model/gtfsImport.ts), used nowhere else in the app's eager import graph —
// no reason to ship that in the main bundle for the common case where this
// dialog is never opened. App already renders it conditionally below, the
// shape React.lazy wants.
const GtfsImportDialog = lazy(() => import("./ui/GtfsImportDialog").then((m) => ({ default: m.GtfsImportDialog })));
// Same reasoning applied to every other dialog gated behind an explicit user
// action (activeDialog === "..."/shortcutsOpen) rather than rendered on
// initial paint — none of these need to be in the first-paint bundle either.
const ExportDialog = lazy(() => import("./ui/ExportDialog").then((m) => ({ default: m.ExportDialog })));
const ImportDialog = lazy(() => import("./ui/ImportDialog").then((m) => ({ default: m.ImportDialog })));
const ShareDialog = lazy(() => import("./ui/ShareDialog").then((m) => ({ default: m.ShareDialog })));
const ShortcutsDialog = lazy(() => import("./ui/ShortcutsDialog").then((m) => ({ default: m.ShortcutsDialog })));
const SystemsDialog = lazy(() => import("./ui/SystemsDialog").then((m) => ({ default: m.SystemsDialog })));

const SHARE_PREFIX = "/s/";

// The common case by far is a chunk whose filename changed under a tab that
// was left open, so "reload" is the actual fix rather than a shrug.
const dialogFailureNotice = "That dialog couldn’t be loaded. Your system is safe — reload the page and try again.";

// Says what still works, because most of it does: the basemap is a backdrop
// from a third-party host, and everything the user has drawn is ours.
const basemapNotice = "The background map couldn’t be loaded, so the map behind your system is blank. Your system is unaffected and still saved.";

// Deliberately says the damaged copy still exists. "Your work is gone" and
// "your work is here but unreadable" call for very different reactions, and
// only one of them is true.
const corruptSystemNotice = "The system you had open couldn’t be read, so this is a new one. The damaged copy is still saved and hasn’t been deleted.";

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
      <Suspense fallback={null}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export function App() {
  const store = useEditorStore();
  const name = useEditor((s) => s.system.name);
  const { shortcutsOpen, closeShortcuts, uiHidden, toggleUi, activeDialog, closeDialog } = useUi();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Anything worth telling the user that isn't the share-load error: a stored
  // system that wouldn't parse, a dialog that failed to load.
  const [notice, setNotice] = useState<string | null>(null);
  // Whether the working copy is actually reaching disk. Anything other than
  // "saved" means the editor is lying about being safe to close.
  const [saveState, setSaveState] = useState<SaveOutcome>("saved");

  // Bootstrap: shared link → read-only load; otherwise local autosave or fresh.
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith(SHARE_PREFIX)) {
      const id = path.slice(SHARE_PREFIX.length).replace(/\/$/, "");
      fetchShare(id)
        .then((system) => store.getState().setSystem(system, { readOnly: true }))
        .catch((e: Error) => setLoadError(e.message))
        .finally(() => setReady(true));
      return;
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
    const activeId = getActiveId();
    const active = activeId ? loadSystemEntry(activeId) : { status: "missing" as const };
    let system = active.status === "ok" ? active.system : null;
    if (active.status === "corrupt") setNotice(corruptSystemNotice);
    if (!system) system = migrateLegacySingleSlot();
    if (!system) {
      const entries = listLibrary();
      if (entries.length > 0) system = loadSystemById(entries[0].id);
    }
    let isBrandNew = false;
    if (!system) {
      system = createEmptySystem();
      isBrandNew = true;
    }
    // The first save is the one that proves storage works at all — a browser
    // in private mode fails here, before the user has typed anything.
    setSaveState(saveToLibrary(system));
    setActiveId(system.id);
    store.getState().setSystem(system, { readOnly: false });
    if (isBrandNew) store.getState().setTool("way");
    setReady(true);
  }, [store]);

  // Autosave the working copy into its own library entry (never a read-only
  // shared view). Switching to a different system's id updates the active
  // pointer immediately — no reason to debounce that, only the content save.
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    return store.subscribe((s, prev) => {
      if (s.readOnly) return;
      if (s.system === prev.system) return;
      if (s.system.id !== prev.system.id) setActiveId(s.system.id);
      window.clearTimeout(saveTimer.current);
      const snapshot = s.system;
      saveTimer.current = window.setTimeout(() => setSaveState(saveToLibrary(snapshot)), 400);
    });
  }, [store]);

  // Dev-only: expose the map for debugging (the store is exposed by EditorProvider).
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __getMap?: unknown }).__getMap = getMap;
    }
  }, []);

  // Hiding the UI used to unmount the whole chrome instantly; now it stays
  // mounted (fading/rising out) for the CSS exit transition, and the restore
  // button only appears once that's actually finished — avoiding an instant
  // snap AND the two overlapping in the same top-left corner mid-transition.
  const { mounted: chromeMounted, closing: chromeClosing } = useDelayedUnmount(!uiHidden, 160);
  const selection = useEditor((s) => s.selection);
  const multiSelection = useEditor((s) => s.multiSelection);
  const tool = useEditor((s) => s.tool);
  const readOnly = useEditor((s) => s.readOnly);
  const { viewMode } = useView();
  // The right sidebar is the one dynamic surface for "what's relevant right
  // now" — a selected object's details, OR (when a drawing tool is armed)
  // that tool's own draft options, never a second bottom-bar popup for the
  // latter. Diagram/read-only both disable drawing tools outright (see
  // Toolbar's own `locked`), so an armed tool from before switching there
  // shouldn't still claim this slot.
  const hasSupplementalContent = selection !== null || multiSelection.length > 0 || (tool !== "select" && !readOnly && viewMode !== "diagram");

  const dialogFailed = () => {
    closeDialog();
    setNotice(dialogFailureNotice);
  };

  // Everything app-level and urgent goes through Workbench's one banner slot.
  // A failing autosave outranks the others: the other two describe something
  // that already happened, this one is still happening and gets worse the
  // longer it goes unread.
  const saveMessage =
    saveState === "full"
      ? "Your browser’s storage is full, so your work is no longer being saved. Export this system, or delete one you don’t need, to make room."
      : saveState === "unavailable"
        ? "This browser isn’t saving your work — storage is unavailable here, which private browsing windows often do. Export before closing the tab."
        : null;
  const banner = saveMessage ? (
    <div className="app-banner" role="alert">
      {saveMessage}
    </div>
  ) : loadError ? (
    <div className="app-banner" role="alert">
      Couldn’t open shared system: {loadError}
    </div>
  ) : notice ? (
    <div className="app-banner" role="alert">
      {notice}
    </div>
  ) : null;

  return (
    <div className="app">
      {ready && <MapCanvas onBasemapUnavailable={() => setNotice(basemapNotice)} />}
      {chromeMounted && (
        <div data-ui-state={chromeClosing ? "closed" : "open"} className="app-chrome">
          <Workbench
            banner={banner}
            brand={<TopBarBrand />}
            menuPanel={<LinesPanel />}
            supplementalPanel={<Inspector />}
            hasSupplementalContent={hasSupplementalContent}
            primaryToolbar={<TopBarActions />}
            viewSwitcher={<ViewSwitch />}
            modeToolbar={<Toolbar />}
            importStatus={<ImportProgressPill />}
          />
        </div>
      )}
      {!chromeMounted && uiHidden && (
        <button type="button" className="ui-restore" onClick={toggleUi} title="Show UI (\\)" aria-label={`Show UI — ${name}`}>
          <Icon name="sidebar" size={16} />
          <span className="ui-restore-name">{name}</span>
        </button>
      )}
      {shortcutsOpen && (
        <LazyDialog onFailure={() => { closeShortcuts(); setNotice(dialogFailureNotice); }}>
          <ShortcutsDialog onClose={closeShortcuts} />
        </LazyDialog>
      )}
      {activeDialog === "import" && (
        <LazyDialog onFailure={dialogFailed}>
          <ImportDialog onClose={closeDialog} />
        </LazyDialog>
      )}
      {activeDialog === "gtfs" && (
        <LazyDialog onFailure={dialogFailed}>
          <GtfsImportDialog onClose={closeDialog} />
        </LazyDialog>
      )}
      {activeDialog === "export" && (
        <LazyDialog onFailure={dialogFailed}>
          <ExportDialog onClose={closeDialog} />
        </LazyDialog>
      )}
      {activeDialog === "share" && (
        <LazyDialog onFailure={dialogFailed}>
          <ShareDialog onClose={closeDialog} />
        </LazyDialog>
      )}
      {activeDialog === "systems" && (
        <LazyDialog onFailure={dialogFailed}>
          <SystemsDialog onClose={closeDialog} />
        </LazyDialog>
      )}
    </div>
  );
}
