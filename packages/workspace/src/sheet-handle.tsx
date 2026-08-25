import { useRef, type PointerEvent } from 'react';
import { ChromeIcon } from './chrome-icon';
import type { WorkbenchDetent } from './workspace-slots';

const DETENTS: WorkbenchDetent[] = ['closed', 'half', 'full'];

export function stepDetent(from: WorkbenchDetent, direction: 1 | -1): WorkbenchDetent {
  const next = DETENTS.indexOf(from) + direction;
  return DETENTS[Math.min(DETENTS.length - 1, Math.max(0, next))];
}

interface SheetHandleProps {
  detent: WorkbenchDetent;
  setDetent: (value: WorkbenchDetent | ((previous: WorkbenchDetent) => WorkbenchDetent)) => void;
  title: string;
}

export function SheetHandle({ detent, setDetent, title }: SheetHandleProps) {
  const dragStartY = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const expanded = detent !== 'closed';

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    dragStartY.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const startY = dragStartY.current;
    dragStartY.current = null;
    if (startY === null) return;
    const movement = event.clientY - startY;
    if (Math.abs(movement) > 24) {
      setDetent((current) => stepDetent(current, movement < 0 ? 1 : -1));
      suppressClick.current = true;
    }
  };
  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setDetent((current) => (current === 'closed' ? 'half' : 'closed'));
  };

  return (
    <button
      type="button"
      className="sheet-handle"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
    >
      <span className="sheet-grip" />
      <span className="sheet-title">{title}</span>
      <ChromeIcon
        name="chevronDown"
        size={16}
        style={{ transform: expanded ? undefined : 'rotate(180deg)' }}
      />
    </button>
  );
}
