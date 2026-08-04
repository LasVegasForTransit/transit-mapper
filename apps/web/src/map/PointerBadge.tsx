import type { PointerBadge as PointerBadgeKind, PointerIntent } from '../editor/pointerIntent';
import { Icon, type IconName } from '../ui/Icon';

export interface PointerBadgeProps {
  intent: PointerIntent | null;
  x: number;
  y: number;
}

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
 * the idle hover. Touch has no idle state, so the same answer moves inside the
 * gesture: interactions.ts publishes an intent on touchstart, and this renders
 * it while there is still time to lift and cancel.
 *
 * This component does not ask what kind of pointer it has. Where the badge
 * sits, how big it is, and whether a bare refusal is worth drawing at all are
 * decisions `.pointer-badge` makes in app.css, next to the cursor rules they
 * coordinate with — see its `@media (hover: …)` blocks. Only `x`/`y` are
 * genuinely per-event and stay here.
 */
export function PointerBadge({ intent, x, y }: PointerBadgeProps) {
  if (!intent) return null;
  const refused = !intent.allowed;
  if (!intent.badge && !refused) return null;

  return (
    <span
      className="pointer-badge"
      style={{ left: x, top: y }}
      data-pointer-anchor={intent.anchor}
      data-badge={intent.badge ?? undefined}
      data-pointer-refused={refused || undefined}
      aria-hidden="true"
    >
      <Icon name={intent.badge ? ICON_FOR_BADGE[intent.badge] : 'x'} size={14} />
    </span>
  );
}
