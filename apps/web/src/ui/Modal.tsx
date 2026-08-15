import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { IconButton } from './IconButton';

interface ModalProps {
  title: string;
  description: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
}

interface DialogLifecycle {
  closing: boolean;
  dialogRef: RefObject<HTMLDialogElement>;
  finishClose: () => void;
  requestClose: () => void;
}

function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

function openDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

/** Native modal state stays local long enough to play the existing exit motion. */
function useDialogLifecycle(onClose: () => void): DialogLifecycle {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const finished = useRef(false);
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => setClosing(true), []);
  const finishClose = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    if (dialogRef.current?.open) closeDialog(dialogRef.current);
    if (previouslyFocused.current?.isConnected) previouslyFocused.current.focus();
    onClose();
  }, [onClose]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    if (dialog) openDialog(dialog);
    return () => {
      if (dialog?.open) closeDialog(dialog);
    };
  }, []);
  useLayoutEffect(() => {
    if (dialogRef.current) dialogRef.current.inert = closing;
  }, [closing]);
  useEffect(() => {
    if (!closing) return;
    const fallback = window.setTimeout(finishClose, 200);
    return () => window.clearTimeout(fallback);
  }, [closing, finishClose]);
  return { closing, dialogRef, finishClose, requestClose };
}

function pressLandedOnBackdrop(event: PointerEvent<HTMLDialogElement>): boolean {
  if (event.target !== event.currentTarget) return false;
  const bounds = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  );
}

/**
 * The shared modal shell uses the platform's top layer and focus trap. Current
 * supported browsers provide showModal(), Escape cancellation, scroll locking,
 * and modal accessibility without shipping a parallel dialog implementation.
 */
export function Modal({
  title,
  description,
  onClose,
  className = '',
  children,
  footer,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const lifecycle = useDialogLifecycle(onClose);
  const state = lifecycle.closing ? 'closed' : 'open';

  return (
    <dialog
      ref={lifecycle.dialogRef}
      className={`modal ${className}`.trim()}
      data-state={state}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        lifecycle.requestClose();
      }}
      onClose={lifecycle.finishClose}
      onPointerDown={(event) => {
        if (pressLandedOnBackdrop(event)) lifecycle.requestClose();
      }}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && lifecycle.closing) {
          lifecycle.finishClose();
        }
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <IconButton icon="x" size={20} label="Close" onClick={lifecycle.requestClose} />
      </div>
      <p id={descriptionId} className="sr-only">
        {description}
      </p>
      {children}
      {footer}
    </dialog>
  );
}
