import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_SIM_SPEED_ID, stepSimSpeed } from '@transitmapper/core/sim/clock';
import { createSimClock, type SimClock } from '../sim/simClock';
import { attachSimulationKeyboard } from '../sim/simulation-shortcuts';

// The simulation's SETTINGS — which speed, and whether it's running — plus
// ownership of the one SimClock instance everything else is handed.
//
// Settings live in React context rather than the editor store for the same
// reason ViewProvider's do: presentation state, not part of the transit system
// model, so not saved, shared, or undoable. Like every other view setting they
// also don't survive a reload, which keeps one obvious rule ("view state is
// per-session") rather than one preference quietly behaving differently.
//
// The clock itself is NOT in this context's value. simMs ticks at 30 Hz, and
// anything in a context value re-renders every consumer when it changes. The
// clock is created once here (useRef, so StrictMode's double-invoke can't mint
// two) and exposed through its own hook; consumers that need the live time
// subscribe to the instance and throttle themselves.
interface SimState {
  speedId: string;
  setSpeedId: (id: string) => void;
  /** One step along the speed ladder, clamped at both ends (keyboard `,`/`.`). */
  stepSpeed: (direction: -1 | 1) => void;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  togglePaused: () => void;
  /** A schedule period pinned by name ("Peak", "Weekend"…), or undefined to
   *  follow the clock.
   *
   *  This is the sandbox mode: pin a period and every service runs that
   *  period's configuration whatever time it is, so two service levels can be
   *  compared side by side without waiting for the right hour to come round.
   *  The clock keeps running underneath — vehicles still need a time base to
   *  move against — it just no longer decides which headway applies. */
  pinnedPeriod: string | undefined;
  setPinnedPeriod: (label: string | undefined) => void;
}

const SimContext = createContext<SimState | null>(null);
const SimClockContext = createContext<SimClock | null>(null);

/** Someone who has asked their OS to reduce motion should not be handed a map
 *  of moving dots the moment it loads. The simulation still exists and the
 *  play button still works — it just doesn't start on its own. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

interface SimProviderProps {
  children: ReactNode;
}

export function SimProvider({ children }: SimProviderProps) {
  const [speedId, setSpeedId] = useState(DEFAULT_SIM_SPEED_ID);
  const [paused, setPaused] = useState(prefersReducedMotion);
  const [pinnedPeriod, setPinnedPeriod] = useState<string | undefined>(undefined);
  const clockRef = useRef<SimClock | null>(null);
  clockRef.current ??= createSimClock({ speedId, paused });

  // The one place React state reaches the imperative clock. Runs on mount too,
  // so the clock starts in step with the reduced-motion default rather than
  // running for a frame before React catches up.
  useEffect(() => {
    clockRef.current?.setSettings({ speedId, paused });
  }, [speedId, paused]);

  const stepSpeed = useCallback(
    (direction: -1 | 1) => setSpeedId((id) => stepSimSpeed(id, direction)),
    [],
  );
  const togglePaused = useCallback(() => setPaused((p) => !p), []);

  useEffect(() => attachSimulationKeyboard({ togglePaused, stepSpeed }), [stepSpeed, togglePaused]);

  const value = useMemo<SimState>(
    () => ({
      speedId,
      setSpeedId,
      stepSpeed,
      paused,
      setPaused,
      togglePaused,
      pinnedPeriod,
      setPinnedPeriod,
    }),
    [speedId, stepSpeed, paused, togglePaused, pinnedPeriod],
  );
  return (
    <SimClockContext.Provider value={clockRef.current}>
      <SimContext.Provider value={value}>{children}</SimContext.Provider>
    </SimClockContext.Provider>
  );
}

export function useSim(): SimState {
  const ctx = useContext(SimContext);
  if (!ctx) throw new Error('useSim must be used within <SimProvider>');
  return ctx;
}

export function useSimClock(): SimClock {
  const ctx = useContext(SimClockContext);
  if (!ctx) throw new Error('useSimClock must be used within <SimProvider>');
  return ctx;
}
