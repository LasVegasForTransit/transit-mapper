import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

type PanelSlot = 'left' | 'right';

interface PanelProps extends HTMLAttributes<HTMLElement> {
  /** Which overlay-grid slot this card docks into — see .app-chrome's
   *  grid-template-areas in app.css. */
  slot: PanelSlot;
  children: ReactNode;
}

/**
 * The one card shell every floating side panel renders through — SidePanel
 * (left) and every Inspector variant (right: Empty/Multi/Service/Way/
 * Stop/Facility/Group each used to hand-roll this exact
 * `<aside className="panel panel-right">` themselves, seven identical
 * copies of the same wrapper).
 *
 * Bakes in the one guarantee every panel needs regardless of how much
 * content it holds: a viewport-bounded height with internal scroll (see
 * .panel's own comment in app.css) — a call site can't quietly ship
 * without that the way one of the seven above once could have, since
 * there's now exactly one place this markup is written.
 *
 * forwardRef exists for MenuCard's own use — it measures this element's
 * DOM node directly to drive the zen-mode width morph (see that
 * component's comment). No other current caller needs the ref.
 */
export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { slot, className = '', children, ...rest },
  ref,
) {
  return (
    <aside ref={ref} className={`panel panel-${slot} ${className}`.trim()} {...rest}>
      {children}
    </aside>
  );
});
