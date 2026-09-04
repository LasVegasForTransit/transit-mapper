import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon } from './Icon';
import type { FloatingAlign } from './floating-position';
import { NativePopover } from './native-popover';

interface DropdownMenuProps {
  trigger: ReactElement;
  children: ReactNode;
  align?: FloatingAlign;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  sideOffset?: number;
}

const MenuCloseContext = createContext<(() => void) | null>(null);
const MENU_ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"]';

function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR)).filter(
    (item) => item.getAttribute('aria-disabled') !== 'true',
  );
}

function focusMenuItem(items: HTMLElement[], item: HTMLElement): void {
  for (const candidate of items) candidate.tabIndex = candidate === item ? 0 : -1;
  item.focus();
}

function focusAtOffset(menu: HTMLElement, offset: number): void {
  const items = menuItems(menu);
  if (items.length === 0) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = (current + offset + items.length) % items.length;
  focusMenuItem(items, items[next]);
}

function focusPointerMenuItem(item: HTMLElement): void {
  const menu = item.closest<HTMLElement>('[role="menu"]');
  if (menu) focusMenuItem(menuItems(menu), item);
}

interface TypeaheadState {
  text: string;
  resetTimer?: number;
}

function focusTypeaheadMatch(menu: HTMLElement, state: TypeaheadState, key: string): void {
  if (state.resetTimer !== undefined) window.clearTimeout(state.resetTimer);
  const normalized = key.toLocaleLowerCase();
  const repeats = state.text.length > 0 && state.text.replaceAll(normalized, '') === '';
  state.text = repeats ? normalized : state.text + normalized;
  state.resetTimer = window.setTimeout(() => {
    state.text = '';
    state.resetTimer = undefined;
  }, 500);
  const items = menuItems(menu);
  const current = items.indexOf(document.activeElement as HTMLElement);
  const searchOrder = items.slice(current + 1).concat(items.slice(0, current + 1));
  const match = searchOrder.find((item) =>
    item.textContent.trim().toLocaleLowerCase().startsWith(state.text),
  );
  if (match) focusMenuItem(items, match);
}

function useMenuKeyDown(close: () => void) {
  const typeahead = useRef<TypeaheadState>({ text: '' });
  useEffect(
    () => () => {
      if (typeahead.current.resetTimer !== undefined) {
        window.clearTimeout(typeahead.current.resetTimer);
      }
    },
    [],
  );
  return useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusAtOffset(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const items = menuItems(event.currentTarget);
        const item = event.key === 'Home' ? items[0] : items.at(-1);
        if (item) focusMenuItem(items, item);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        close();
      } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        focusTypeaheadMatch(event.currentTarget, typeahead.current, event.key);
      }
    },
    [close],
  );
}

/** Action menu with native Popover light dismissal and ARIA menu keyboard behavior. */
export function DropdownMenu({
  trigger,
  children,
  align = 'end',
  open,
  onOpenChange,
  sideOffset = 8,
}: DropdownMenuProps) {
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
  const close = useCallback(() => setVisible(false), [setVisible]);
  const onKeyDown = useMenuKeyDown(close);
  return (
    <MenuCloseContext.Provider value={close}>
      <NativePopover
        open={visible}
        onOpenChange={setVisible}
        trigger={trigger}
        className="dropdown-menu-content"
        align={align}
        side="bottom"
        gap={sideOffset}
        role="menu"
        triggerMode="menu"
        onSurfaceKeyDown={onKeyDown}
      >
        {children}
      </NativePopover>
    </MenuCloseContext.Provider>
  );
}

interface DropdownMenuItemProps {
  onSelect: () => void;
  children: ReactNode;
  checked?: boolean;
}

function useMenuClose(): () => void {
  return useContext(MenuCloseContext) ?? (() => undefined);
}

export function DropdownMenuItem({ onSelect, children, checked }: DropdownMenuItemProps) {
  const close = useMenuClose();
  const role = checked === undefined ? 'menuitem' : 'menuitemradio';
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      tabIndex={-1}
      className="dropdown-menu-item"
      onPointerMove={(event) => focusPointerMenuItem(event.currentTarget)}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      {children}
    </button>
  );
}

interface DropdownMenuLinkProps {
  href: string;
  children: ReactNode;
}

export function DropdownMenuLink({ href, children }: DropdownMenuLinkProps) {
  const close = useMenuClose();
  return (
    <a
      role="menuitem"
      tabIndex={-1}
      className="dropdown-menu-item"
      href={href}
      onPointerMove={(event) => focusPointerMenuItem(event.currentTarget)}
      onClick={close}
    >
      {children}
    </a>
  );
}

interface DropdownMenuChoiceProps {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}

export function DropdownMenuChoice({ checked, onSelect, children }: DropdownMenuChoiceProps) {
  return (
    <DropdownMenuItem checked={checked} onSelect={onSelect}>
      <span className="dropdown-menu-choice">
        {checked ? <Icon name="check" size={14} /> : <span className="dropdown-menu-tick" />}
        {children}
      </span>
    </DropdownMenuItem>
  );
}

interface DropdownMenuLabelProps {
  children: ReactNode;
}

export function DropdownMenuLabel({ children }: DropdownMenuLabelProps) {
  return (
    <div role="presentation" className="dropdown-menu-label">
      {children}
    </div>
  );
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="dropdown-menu-separator" />;
}
