import { useEditor } from '../../editor/EditorProvider';
import type { LatchedModifierChannel } from '../../editor/store';
import { useHoverCapable } from '../device-capabilities';

/**
 * The modifier channels, as controls rather than as held keys.
 *
 * Alt, Shift, and Ctrl qualify real operations — erase a point, snap to an
 * angle, split a corridor. A touchscreen cannot hold any of them, and a
 * chorded finger gesture per modifier is not something anyone would learn, so
 * the channels latch here instead and stay on until switched off.
 *
 * Rendered for every pointer type on purpose. On a mouse these are live
 * indicators of what is currently held, and clicking one latches it: the keys
 * keep working untouched, so muscle memory survives, while the modifiers stop
 * being undiscoverable. Today the only way to learn that Alt erases is to open
 * the shortcuts dialog and read it.
 *
 * This lives in the inspector, beside a tool's other draft options, and not in
 * a strip above the tool dock. That strip existed once and was deliberately
 * removed — see drafts.tsx's own comment — because the app keeps one dynamic
 * surface, not two.
 */
interface ChannelDescriptor {
  channel: LatchedModifierChannel;
  label: string;
  /** The key this channel is bound to, shown only where a keyboard is likely. */
  key: string;
  /** What latching it does, in the terms the interface uses elsewhere. */
  hint: string;
}

const CHANNELS: ChannelDescriptor[] = [
  {
    channel: 'alternate',
    label: 'Erase',
    key: 'Alt',
    hint: 'Remove points, stations, and facilities you press. In the Line tool, draw deliberately separate infrastructure instead of sharing.',
  },
  {
    channel: 'constrain',
    label: 'Constrain',
    key: 'Shift',
    hint: 'Hold a drag to the angle of the segment it continues.',
  },
  {
    channel: 'secondary',
    label: 'Split / extend',
    key: 'Ctrl',
    hint: 'Split a corridor at an interior point, or extend it from an end.',
  },
];

export function ModifierChannels() {
  const latched = useEditor((s) => s.latchedModifiers);
  const setLatchedModifier = useEditor((s) => s.setLatchedModifier);
  const hoverCapable = useHoverCapable();

  return (
    <div className="insp-section">
      <span className="field-label" id="modifier-channels-label">
        Modifiers
      </span>
      <div className="chip-row" role="group" aria-labelledby="modifier-channels-label">
        {CHANNELS.map(({ channel, label, key, hint }) => {
          const active = latched[channel];
          return (
            <button
              key={channel}
              type="button"
              // aria-pressed, not aria-checked: these are independent toggles,
              // not a single choice among alternatives.
              aria-pressed={active}
              aria-label={`${label}${hoverCapable ? ` (${key})` : ''}. ${hint}`}
              className={`chip ${active ? 'active' : ''}`}
              onClick={() => setLatchedModifier(channel, !active)}
            >
              {label}
              {hoverCapable && <span className="chip-key">{key}</span>}
            </button>
          );
        })}
      </div>
      <p className="panel-hint">
        {hoverCapable
          ? 'Hold the key, or switch one on to keep it on.'
          : 'Stays on until you switch it off.'}
      </p>
    </div>
  );
}
