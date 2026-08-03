import type { PointerBadge as PointerBadgeKind, PointerIntent } from '../editor/pointerIntent';
import { useHoverCapable } from '../ui/device-capabilities';
import { Icon, type IconName } from '../ui/Icon';

export interface PointerBadgeProps {
  intent: PointerIntent | null;
  x: number;
  y: number;
}

/**
 * Distance from the contact point to the badge.
 *
 * A mouse cursor is drawn below-right of its hotspot, so the badge sits
 * below-right of it too and nothing is covered. A fingertip covers everything
 * under it and roughly 24px around it, so the badge goes ABOVE the touch —
 * below-right would put it under the hand that is asking what the gesture will
 * do.
 */
const HOVER_OFFSET = { x: 14, y: 14 };
const TOUCH_OFFSET = { x: -12, y: -44 };

const ICON_FOR_BADGE: Record<PointerBadgeKind, IconName> = {
  extend: 'line',
  loop: 'redo',
  connect: 'line',
  new: 'plus',
  separate: 'road',
  'one-way-return': 'redo',
  move: 'pan',
  constrain: 'geoStraight',
  erase: 'trash',
  split: 'line',
};

/**
 * A visual qualifier beside the pointer; it never catches the pointer.
 *
 * With a mouse this answers "what will this press do" BEFORE the press, from
 * the idle hover. Touch has no idle state, so the same answer has to move
 * inside the gesture: interactions.ts publishes an intent on touchstart, and
 * this renders it above the finger while there is still time to lift and
 * cancel. Same guarantee, later in the gesture.
 *
 * A refused intent also needs to be visible here on touch. With a mouse the
 * `not-allowed` cursor carries that on its own, and no cursor changes for a
 * finger.
 */
export function PointerBadge({ intent, x, y }: PointerBadgeProps) {
  const hoverCapable = useHoverCapable();
  if (!intent) return null;
  const refused = !intent.allowed;
  // A refusal is worth drawing even with no badge icon to put in it, but only
  // where the cursor cannot say it instead.
  if (!intent.badge && !(refused && !hoverCapable)) return null;

  const offset = hoverCapable ? HOVER_OFFSET : TOUCH_OFFSET;
  const tone = refused
    ? 'border-[var(--md-sys-color-error)] text-[var(--md-sys-color-error)]'
    : 'border-[var(--md-sys-color-outline-variant)] text-[var(--md-sys-color-primary)]';
  return (
    <span
      className={`pointer-events-none fixed z-50 flex items-center justify-center rounded-full border bg-[var(--md-sys-color-surface-container)] shadow-[var(--md-sys-elevation-level2)] ${tone} ${
        hoverCapable ? 'h-5 w-5' : 'h-8 w-8'
      }`}
      style={{ left: x + offset.x, top: y + offset.y }}
      data-pointer-anchor={intent.anchor}
      data-pointer-refused={refused || undefined}
      aria-hidden="true"
    >
      <Icon
        name={intent.badge ? ICON_FOR_BADGE[intent.badge] : 'x'}
        size={hoverCapable ? 14 : 18}
      />
    </span>
  );
}
