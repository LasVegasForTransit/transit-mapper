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
 * The narrow rendering. Same state, same handlers: what changes is that the
 * four-button speed ladder folds into a popover, leaving the two things worth
 * a permanent place — whether it is running, and what time it is.
 *
 * Not a phone special case. Workbench picks this whenever the top row cannot
 * afford the wide one, which starts at about 1090px: below that the wide bar
 * wanted 337px, got 153, and scrolled the difference away behind
 * `scrollbar-width: none`, so the clock rendered 0 of its 100px with nothing
 * on screen to say it existed.
 *
 * This used to collapse the ladder into a native `<select>`. That was 95px
 * against this popover's 34, and it was the only browser-styled form control
 * anywhere in the chrome — sitting next to a custom segmented control doing
 * the same kind of job.
 */
export function SimControlsCompact() {
  const { paused, togglePaused } = useSim();
  return (
    <div className="sim-controls" role="group" aria-label="Simulation">
      <SimPlayPause paused={paused} onToggle={togglePaused} />
      <SimClockReadout />
      <SimSpeedPopover />
      <ScenarioPicker />
    </div>
  );
}

/**
 * The speed ladder, kept whole, behind a trigger that costs a third of its
 * width. The same buttons as the wide bar's, so nothing is reachable in one
 * rendering and missing from the other.
 *
 * The trigger wears the current speed rather than an icon. That keeps the one
 * thing the wide ladder gave you for free — reading the speed without acting
 * — and no glyph says "4× faster than real time" anyway.
 */
function SimSpeedPopover() {
  const { speedId, setSpeedId } = useSim();
  const current = SIM_SPEEDS.find((s) => s.id === speedId);
  return (
    <Popover
      className="sim-scenario-popover"
      trigger={
        <button
          type="button"
          className="sim-speed-trigger"
          aria-label={`Simulation speed: ${current?.label ?? speedId}`}
        >
          {current?.label ?? speedId}
        </button>
      }
    >
      <>
        <span className="panel-section-label">Simulation speed</span>
        <p className="panel-hint">How fast the simulated clock runs against real time.</p>
        <div className="segmented" role="group" aria-label="Simulation speed">
          {SIM_SPEEDS.map((s) => (
            <button
              key={s.id}
              className={`seg ${speedId === s.id ? 'active' : ''}`}
              aria-pressed={speedId === s.id}
              aria-label={`${s.label} — ${s.dayLabel}`}
              onClick={() => setSpeedId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </>
    </Popover>
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
    // The class goes on Popover (its Radix Content), not on an inner div:
    // Content is what carries `data-state`, so that's the only element the
    // open/close animation can key off.
    <Popover
      className="sim-scenario-popover"
      trigger={
        <IconButton
          icon="clock"
          size={17}
          label="Service scenario"
          active={pinnedPeriod !== undefined}
        />
      }
    >
      <>
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
      </>
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
