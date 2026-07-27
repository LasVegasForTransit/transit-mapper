import { useMemo } from 'react';
import { formatSimClock, schedulePeriodLabels, SIM_SPEEDS } from '@transitmapper/core/sim/clock';
import { useEditor } from '../editor/EditorProvider';
import { IconButton } from './IconButton';
import { Popover } from './Popover';
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
      <ScenarioPicker />
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
      <ScenarioPicker />
    </div>
  );
}

/**
 * Pin a schedule period, or follow the clock.
 *
 * Behind a popover rather than inline: this card already holds the view
 * switch, four speed buttons and a clock, and at 1280px an inline select
 * pushed it into the actions card in the top-right corner. It's also an
 * occasional control — you pin a scenario to compare two service levels,
 * then leave it alone — so a trigger that reads "pinned" at a glance is
 * enough on the bar itself.
 *
 * Renders nothing at all until some service actually has named periods. Most
 * systems use one flat headway, and a picker offering a single choice is
 * clutter. The options come from the periods themselves (see
 * schedulePeriodLabels), the way layer filters come from the catalogs.
 */
function ScenarioPicker() {
  const services = useEditor((s) => s.system.services);
  const { pinnedPeriod, setPinnedPeriod } = useSim();
  // The selector returns the stable services array; deriving the label list
  // inside it would mint a new array on every store read and trip zustand's
  // "getSnapshot should be cached" loop.
  const labels = useMemo(() => schedulePeriodLabels(services), [services]);
  if (labels.length === 0) return null;
  return (
    <Popover
      trigger={
        <IconButton
          icon="clock"
          size={17}
          label="Service scenario"
          active={pinnedPeriod !== undefined}
        />
      }
    >
      <div className="sim-scenario-popover">
        <span className="panel-section-label">Service scenario</span>
        <p className="panel-hint">
          Show every line at one point in its schedule, whatever the clock says.
        </p>
        <div className="chip-row" role="group" aria-label="Service scenario">
          <button
            type="button"
            className={`chip ${pinnedPeriod === undefined ? 'active' : ''}`}
            aria-pressed={pinnedPeriod === undefined}
            onClick={() => setPinnedPeriod(undefined)}
          >
            Live clock
          </button>
          {labels.map((label) => (
            <button
              key={label}
              type="button"
              className={`chip ${pinnedPeriod === label ? 'active' : ''}`}
              aria-pressed={pinnedPeriod === label}
              onClick={() => setPinnedPeriod(label)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </Popover>
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
  const { pinnedPeriod } = useSim();
  // With a scenario pinned the clock still runs — vehicles need a time base to
  // move against — but it is no longer deciding which headway applies. Saying
  // so quietly beats letting someone wonder why 03:00 looks like rush hour.
  return (
    <span
      className={`sim-clock ${pinnedPeriod ? 'sim-clock-overridden' : ''}`}
      title={
        pinnedPeriod
          ? `Service pinned to “${pinnedPeriod}” — the clock still runs, but isn't choosing headways`
          : undefined
      }
    >
      {formatSimClock(simMs)}
    </span>
  );
}
