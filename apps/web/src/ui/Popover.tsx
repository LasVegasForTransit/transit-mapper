import { useCallback, useState, type ReactElement, type ReactNode } from 'react';
import { type FloatingAlign, type FloatingSide } from './floating-position';
import { NativePopover } from './native-popover';

interface PopoverProps {
  trigger: ReactElement;
  children: ReactNode;
  align?: FloatingAlign;
  side?: FloatingSide;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Arbitrary interactive content in the browser's native popover top layer. */
export function Popover({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  className = '',
  open,
  onOpenChange,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = open !== undefined;
  const visible = controlled ? open : internalOpen;
  const setVisible = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );
  return (
    <NativePopover
      open={visible}
      onOpenChange={setVisible}
      trigger={trigger}
      className={`popover-content ${className}`.trim()}
      align={align}
      side={side}
    >
      {children}
    </NativePopover>
  );
}
