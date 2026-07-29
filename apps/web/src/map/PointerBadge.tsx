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

/** A visual qualifier beside the native cursor; it never catches the pointer. */
export function PointerBadge({ intent, x, y }: PointerBadgeProps) {
  if (!intent?.badge) return null;
  const { badge } = intent;
  return (
    <span
      className="pointer-events-none fixed z-50 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--bg)] text-[var(--ink)] shadow-[var(--shadow)]"
      style={{ left: x + 14, top: y + 14 }}
      data-pointer-anchor={intent.anchor}
      aria-hidden="true"
    >
      <Icon name={ICON_FOR_BADGE[badge]} size={14} />
    </span>
  );
}
