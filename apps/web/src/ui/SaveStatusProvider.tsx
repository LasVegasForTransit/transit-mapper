import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { SaveOutcome } from "../storage/localStore";

interface SaveStatusState {
  /** The result of the most recent write. Anything but "saved" means the
   *  editor is currently lying about being safe to close. */
  outcome: SaveOutcome;
  /** Called by every code path that writes to storage. */
  report: (outcome: SaveOutcome) => void;
}

const SaveStatusContext = createContext<SaveStatusState | null>(null);

interface SaveStatusProviderProps {
  children: ReactNode;
}

/**
 * One place for "is the user's work actually reaching disk".
 *
 * This started as local state in `App`, which covered the autosave and
 * nothing else — so `SystemsDialog`'s renames, duplicates and new-system
 * writes could still fail completely silently, which is the exact bug the
 * save-outcome plumbing exists to kill. A write can happen anywhere; the
 * report has to be reachable from anywhere too.
 *
 * Its own context rather than a field on UiState, following the reasoning
 * already written down for ImportProgressContext: every consumer of a
 * provider re-renders when its value identity changes, and this changes on
 * every save.
 */
export function SaveStatusProvider({ children }: SaveStatusProviderProps) {
  const [outcome, setOutcome] = useState<SaveOutcome>("saved");
  // Last write wins, deliberately: a later successful save is evidence that
  // whatever was wrong (quota freed, permission granted) no longer is, so it
  // should clear the warning rather than leave it stuck on screen.
  const report = useCallback((next: SaveOutcome) => setOutcome(next), []);
  const value = useMemo<SaveStatusState>(() => ({ outcome, report }), [outcome, report]);
  return <SaveStatusContext.Provider value={value}>{children}</SaveStatusContext.Provider>;
}

export function useSaveStatus(): SaveStatusState {
  const ctx = useContext(SaveStatusContext);
  if (!ctx) throw new Error("useSaveStatus must be used within <SaveStatusProvider>");
  return ctx;
}
