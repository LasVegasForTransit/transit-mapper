import { formatSimClock, SIM_SPEEDS } from '@transitmapper/core/sim/clock';
import { IconButton } from './IconButton';
import { useSim } from './SimProvider';
import { useSimTime } from './useSimTime';

/**
 * The simulated clock's transport controls: play/pause, the speed ladder, and
 * the time itself.
 *
 * Persistent state of the simulation, not a transient action — which is why it
 * sits beside the view switch rather than in the action cluster, and why the
 * time is always visible rather than hidden behind a popover. Speed only means
 * something next to a clock you can watch move.
 */
export function SimControls() {
  const { speedId, setSpeedId, paused, togglePaused } = useSim();
  return (
    <div className="sim-controls" role="group" aria-label="Simulation">
      <SimPlayPause paused={paused} onToggle={togglePaused} />
      <div className="segmented" role="group" aria-label="Simulation speed">
        {SIM_SPEEDS.map((s) => (
          <button
            key={s.id}
            className={`seg ${speedId === s.id ? 'active' : ''}`}
            aria-pressed={speedId === s.id}
            // A bare `title` would REPLACE the visible label in the
            // accessibility tree, leaving a button announced only as "a full
            // day in 6 minutes" with no hint of which speed that is. The
            // label leads; the day length explains it.
            title={s.dayLabel}
            aria-label={`${s.label} — ${s.dayLabel}`}
            onClick={() => setSpeedId(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <SimClockReadout />
    </div>
  );
}

/**
 * The narrow rendering, for a phone's top-left card. Same state, same
 * handlers — four speed buttons and a clock won't fit beside a view switch at
 * that width, so the ladder collapses into a select. A layout difference, not
 * a behavior one.
 */
export function SimControlsCompact() {
  const { speedId, setSpeedId, paused, togglePaused } = useSim();
  return (
    <div className="sim-controls" role="group" aria-label="Simulation">
      <SimPlayPause paused={paused} onToggle={togglePaused} />
      <select
        className="opt-select"
        aria-label="Simulation speed"
        value={speedId}
        onChange={(e) => setSpeedId(e.target.value)}
      >
        {SIM_SPEEDS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <SimClockReadout />
    </div>
  );
}

interface SimPlayPauseProps {
  paused: boolean;
  onToggle: () => void;
}

function SimPlayPause({ paused, onToggle }: SimPlayPauseProps) {
  return (
    <IconButton
      icon={paused ? 'play' : 'pause'}
      size={17}
      label={paused ? 'Run the simulation (K)' : 'Pause the simulation (K)'}
      onClick={onToggle}
    />
  );
}

/**
 * The only thing in the app that re-renders on the clock. It subscribes to the
 * clock instance directly instead of reading simulated time from context: a
 * value that ticks 30 times a second would otherwise re-render every consumer
 * of that context, and this is a single line of text.
 */
function SimClockReadout() {
  const simMs = useSimTime();
  return <span className="sim-clock">{formatSimClock(simMs)}</span>;
}
