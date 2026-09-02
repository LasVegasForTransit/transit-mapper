import { lazy } from 'react';

// Lazy-loaded: pulls in fflate + the GTFS parsing pipeline (packages/core's
// model/gtfsImport.ts), used nowhere else in the app's eager import graph —
// no reason to ship that in the editor-host chunk for the common case where
// this dialog is never opened. Its host renders it conditionally, which is
// the shape React.lazy wants.
export const GtfsImportDialog = lazy(() =>
  import('./GtfsImportDialog').then((m) => ({ default: m.GtfsImportDialog })),
);
// Same reasoning applied to every other dialog gated behind an explicit user
// action (activeDialog === "..."/shortcutsOpen) rather than rendered on
// initial paint — none of these need to be in the first-paint bundle either.
export const ExportDialog = lazy(() =>
  import('./ExportDialog').then((m) => ({ default: m.ExportDialog })),
);
export const ImportDialog = lazy(() =>
  import('./ImportDialog').then((m) => ({ default: m.ImportDialog })),
);
export const ShareDialog = lazy(() =>
  import('./ShareDialog').then((m) => ({ default: m.ShareDialog })),
);
export const SavedViewsDialog = lazy(() =>
  import('./saved-views-dialog').then((module) => ({ default: module.SavedViewsDialog })),
);
export const ShortcutsDialog = lazy(() =>
  import('./ShortcutsDialog').then((m) => ({ default: m.ShortcutsDialog })),
);
export const SystemsDialog = lazy(() =>
  import('./SystemsDialog').then((m) => ({ default: m.SystemsDialog })),
);
export const SettingsDialog = lazy(() =>
  import('./SettingsDialog').then((m) => ({ default: m.SettingsDialog })),
);
export const FirstRunDialogs = lazy(() =>
  import('./onboarding/first-run-dialogs').then((module) => ({
    default: module.FirstRunDialogs,
  })),
);
export const AboutDialog = lazy(() =>
  import('./about-dialog').then((m) => ({ default: m.AboutDialog })),
);
