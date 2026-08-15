import {
  cloneElement,
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import {
  positionFloatingSurface,
  type FloatingAlign,
  type FloatingSide,
} from './floating-position';

interface AnchorStyle extends CSSProperties {
  '--tm-floating-gap'?: string;
  anchorName?: string;
  positionAnchor?: string;
}

interface NativeTriggerProps {
  ref?: Ref<HTMLElement>;
  style?: AnchorStyle;
  disabled?: boolean;
  'aria-controls'?: string;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: 'menu';
  'data-state'?: 'closed' | 'open';
  onClick?: MouseEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onPointerDown?: PointerEventHandler<HTMLElement>;
}

interface NativePopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  children: ReactNode;
  className: string;
  align: FloatingAlign;
  side: FloatingSide;
  gap?: number;
  role?: string;
  focusOnOpen?: boolean;
  triggerMode?: 'click' | 'menu';
  onSurfaceKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}

interface PlacementInput {
  trigger: HTMLElement;
  surface: HTMLElement;
  align: FloatingAlign;
  side: FloatingSide;
  gap: number;
}

interface PopoverToggleEvent extends Event {
  newState?: 'closed' | 'open';
}

type InitialFocus = 'first' | 'last';

const FOCUSABLE =
  'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
const NATIVE_POPOVER_ATTRIBUTE = { popover: 'auto' } as const;

function supportsAnchorPositioning(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    CSS.supports('anchor-name: --tm-anchor') &&
    CSS.supports('position-anchor: --tm-anchor')
  );
}

function updateFallbackPlacement(input: PlacementInput): void {
  if (supportsAnchorPositioning()) return;
  const anchor = input.trigger.getBoundingClientRect();
  const bounds = input.surface.getBoundingClientRect();
  const position = positionFloatingSurface({
    anchor,
    surface: { width: bounds.width, height: bounds.height },
    viewport: { width: window.innerWidth, height: window.innerHeight, padding: 12 },
    preference: { side: input.side, align: input.align, gap: input.gap },
  });
  input.surface.style.left = `${position.left}px`;
  input.surface.style.top = `${position.top}px`;
  input.surface.dataset.resolvedSide = position.side;
}

function showSurface(surface: HTMLElement): void {
  if (typeof surface.showPopover === 'function') surface.showPopover();
  else surface.hidden = false;
}

function hideSurface(surface: HTMLElement): void {
  if (typeof surface.hidePopover === 'function') surface.hidePopover();
  else surface.hidden = true;
}

function focusInitialControl(surface: HTMLElement, initialFocus: InitialFocus): void {
  const controls = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE));
  const control = initialFocus === 'last' ? controls.at(-1) : controls[0];
  if (!control) return;
  if (control.matches('[role="menuitem"],[role="menuitemradio"]')) control.tabIndex = 0;
  control.focus();
}

interface SurfaceLifecycleInput extends Omit<PlacementInput, 'surface' | 'trigger'> {
  triggerRef: RefObject<HTMLElement>;
  onOpenChange: (open: boolean) => void;
  focusOnOpen: boolean;
  initialFocus: InitialFocus;
}

function useSurfaceLifecycle(
  surfaceRef: RefObject<HTMLDivElement>,
  input: SurfaceLifecycleInput,
): void {
  const { align, focusOnOpen, gap, initialFocus, side, triggerRef } = input;
  const onOpenChangeRef = useRef(input.onOpenChange);
  onOpenChangeRef.current = input.onOpenChange;
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const trigger = triggerRef.current;
    if (!surface || !trigger) return;
    let shown = false;
    const placement: PlacementInput = {
      trigger,
      surface,
      align,
      side,
      gap,
    };
    const update = () => updateFallbackPlacement(placement);
    const handleToggle = (event: Event) => {
      const isOpen = (event as PopoverToggleEvent).newState === 'open';
      shown = isOpen;
      if (!isOpen) onOpenChangeRef.current(false);
    };
    surface.addEventListener('toggle', handleToggle);
    showSurface(surface);
    shown = true;
    update();
    if (focusOnOpen) focusInitialControl(surface, initialFocus);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(trigger);
    observer?.observe(surface);
    return () => {
      const returnFocus = surface.contains(document.activeElement);
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      surface.removeEventListener('toggle', handleToggle);
      if (shown) hideSurface(surface);
      if (returnFocus && trigger.isConnected) trigger.focus();
    };
  }, [align, focusOnOpen, gap, initialFocus, side, surfaceRef, triggerRef]);
}

interface NativeSurfaceProps extends Omit<NativePopoverProps, 'children' | 'open' | 'trigger'> {
  anchorName: string;
  children: ReactNode;
  initialFocus: InitialFocus;
  surfaceId: string;
  triggerRef: RefObject<HTMLElement>;
}

function NativeSurface(props: NativeSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  useSurfaceLifecycle(surfaceRef, {
    triggerRef: props.triggerRef,
    align: props.align,
    side: props.side,
    gap: props.gap ?? 8,
    focusOnOpen: props.focusOnOpen ?? true,
    initialFocus: props.initialFocus,
    onOpenChange: props.onOpenChange,
  });
  const style: AnchorStyle = {
    positionAnchor: props.anchorName,
    '--tm-floating-gap': `${props.gap ?? 8}px`,
  };
  return (
    <div
      {...NATIVE_POPOVER_ATTRIBUTE}
      ref={surfaceRef}
      id={props.surfaceId}
      role={props.role}
      className={`${props.className} tm-anchored-surface`}
      data-state="open"
      data-side={props.side}
      data-align={props.align}
      style={style}
      onKeyDown={props.onSurfaceKeyDown}
    >
      {props.children}
    </div>
  );
}

function anchorNameFor(id: string): string {
  return `--tm-${id.replaceAll(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** Shared Popover API/top-layer shell for menus and arbitrary controls. */
export function NativePopover(props: NativePopoverProps) {
  const surfaceId = useId();
  const triggerRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<InitialFocus>('first');
  const anchorName = anchorNameFor(surfaceId);
  const trigger = props.trigger as ReactElement<NativeTriggerProps>;
  const triggerStyle: AnchorStyle = { ...trigger.props.style, anchorName };
  const isMenu = props.triggerMode === 'menu';
  const toggle = () => props.onOpenChange(!props.open);
  const renderedTrigger = cloneElement(trigger, {
    ref: triggerRef,
    style: triggerStyle,
    'aria-controls': surfaceId,
    'aria-expanded': props.open,
    'aria-haspopup': isMenu ? 'menu' : undefined,
    'data-state': props.open ? 'open' : 'closed',
    onClick: (event) => {
      trigger.props.onClick?.(event);
      if (!event.defaultPrevented) {
        initialFocusRef.current = 'first';
        toggle();
      }
    },
    onPointerDown: (event) => {
      trigger.props.onPointerDown?.(event);
    },
    onKeyDown: (event) => {
      trigger.props.onKeyDown?.(event);
      if (
        !event.defaultPrevented &&
        isMenu &&
        (event.key === 'ArrowDown' || event.key === 'ArrowUp')
      ) {
        event.preventDefault();
        initialFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
        props.onOpenChange(true);
      }
    },
  });
  return (
    <>
      {renderedTrigger}
      {props.open && (
        <NativeSurface
          {...props}
          anchorName={anchorName}
          initialFocus={initialFocusRef.current}
          surfaceId={surfaceId}
          triggerRef={triggerRef}
        />
      )}
    </>
  );
}
