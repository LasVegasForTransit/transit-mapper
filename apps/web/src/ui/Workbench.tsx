import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useEditor } from '../editor/EditorProvider';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Panel } from './Panel';
import { useInertRef } from './useInertRef';
import { useUi } from './UiProvider';

// Tailwind's `md` breakpoint is min-width: 768px. The component tree must use
// the same boundary as the CSS: mounting both trees and hiding one with
// display utilities leaves every hidden panel subscribed to the editor store.
const MOBILE_QUERY = '(max-width: 767px)';

function mobileSnapshot(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(MOBILE_QUERY).matches === true;
}

function subscribeMobile(listener: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(MOBILE_QUERY);
  const onChange = () => listener();
  if (query.addEventListener) {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }
  // Safari < 14. The app does not target it deliberately, but this fallback
  // costs nothing and makes the subscription safe in older embedded browsers.
  query.addListener(onChange);
  return () => query.removeListener(onChange);
}

function useMobileLayout(): boolean {
  // This app is client-rendered rather than hydrated. Reusing the guarded live
  // snapshot for the server argument also makes static render tests represent
  // the media environment they install without introducing a second default.
  return useSyncExternalStore(subscribeMobile, mobileSnapshot, mobileSnapshot);
}

/** How much of the action bar's content fits. Each step is narrower than the
 *  one before it, so the first that fits is the most complete that fits.
 *  app.css owns what each one drops, keyed off `[data-fit]`. */
type ToolbarFit = 'full' | 'labels' | 'tertiary' | 'overflow';

const TOOLBAR_FITS: ToolbarFit[] = ['full', 'labels', 'tertiary', 'overflow'];

/** Measures a `.top-app-bar`'s natural width. A bar never compresses its
 *  contents and scrolls when it is short, so neither its rendered width nor
 *  its scrollWidth says what it actually wants. */
function naturalWidth(bar: HTMLElement): number {
  const width = bar.style.width;
  const flex = bar.style.flex;
  bar.style.flex = 'none';
  bar.style.width = 'max-content';
  const measured = bar.getBoundingClientRect().width;
  bar.style.flex = flex;
  bar.style.width = width;
  return measured;
}

/**
 * Picks the widest action bar that fits the width its container was given.
 *
 * The input is the container, not the viewport: Workbench's top row divides
 * itself between a reserved left edge, the canvas-state bar and this one, so
 * the same viewport hands this bar different widths as its neighbours change.
 * Each step is priced by writing `data-fit` onto the live element and reading
 * its width back, then restoring what React rendered — a width table in JS
 * would be a copy of app.css that goes stale silently. It all happens in a
 * layout effect, so nothing intermediate is painted.
 *
 * The bar cannot wrap whatever this returns: `.top-app-bar` is `nowrap`, and
 * the last step scrolls. This only decides how much of the content is worth
 * showing before the ⋯ menu takes the rest.
 */
function useToolbarFit(
  container: RefObject<HTMLDivElement | null>,
  bar: RefObject<HTMLDivElement | null>,
  mobile: boolean,
): ToolbarFit {
  const [fit, setFit] = useState<ToolbarFit>('full');

  useLayoutEffect(() => {
    const box = container.current;
    const el = bar.current;
    if (mobile || !box || !el) return;

    const measure = () => {
      const rendered = el.dataset.fit;
      const widths = TOOLBAR_FITS.map((candidate) => {
        el.dataset.fit = candidate;
        return naturalWidth(el);
      });
      if (rendered === undefined) delete el.dataset.fit;
      else el.dataset.fit = rendered;

      // The smallest step is the floor the row must respect. Without it the
      // container keeps taking its share of a shrinking row and the bar ends
      // up scrolling its own ⋯ button out of reach; with it, the
      // canvas-state bar beside it gives way instead.
      const floor = `${Math.ceil(widths[widths.length - 1])}px`;
      if (box.style.minWidth !== floor) box.style.minWidth = floor;

      const available = box.clientWidth;
      const index = widths.findIndex((width) => width <= available);
      setFit(TOOLBAR_FITS[index === -1 ? TOOLBAR_FITS.length - 1 : index]);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    // The bar too, not just its container. What the bar wants changes without
    // the row moving at all: the issues badge mounts when validation starts
    // failing, and forking a read-only system swaps two buttons for six.
    // Neither resizes the container — it is `flex-1` from a zero basis — so
    // watching only the container leaves the step stale, and the bar quietly
    // scrolls its own content out of view instead of stepping down.
    observer.observe(el);
    return () => observer.disconnect();
  }, [container, bar, mobile]);

  return fit;
}

export interface WorkbenchProps {
  /** File menu / system name / Hide-UI toggle. Docks into the menu panel's
   *  own header on desktop; mobile has nowhere else for it to live, since
   *  the menu panel itself becomes a bottom sheet there, so it renders in
   *  the top bar instead. One prop, two positions — Workbench decides
   *  which through the media query matching Tailwind's md breakpoint, not
   *  the caller. */
  brand: ReactNode;
  /** The active view's workspace — desktop wraps it in a collapsible card with `brand`
   *  above it; mobile wraps it in the bottom sheet instead. */
  menuPanel: ReactNode;
  /** The one dynamic, contextual surface: a selected object's details, OR
   *  (when a drawing tool is armed) that tool's own draft options — never
   *  both at once, and never a second version of either elsewhere. Desktop
   *  docks it as its own card on the right; mobile swaps the sheet over to
   *  it. Null when there's nothing to show. */
  supplementalPanel: ReactNode;
  /** Whether supplementalPanel actually has something to show right now —
   *  drives the mobile sheet's List⇄Details toggle. */
  hasSupplementalContent: boolean;
  /** Undo/redo/export/share/issues/layers/keyboard — the transient-action
   *  cluster, distinct from viewSwitcher (persistent canvas state). */
  primaryToolbar: ReactNode;
  /** Network/Infrastructure/Diagram — a persistent view state, not a
   *  transient action, so it's its own slot rather than folded into
   *  primaryToolbar (desktop only has room to show this distinction). */
  viewSwitcher: ReactNode;
  /** Play/pause, simulation speed, and the simulated clock. Persistent state
   *  of the canvas like `viewSwitcher`, so it shares that card. */
  simControls: ReactNode;
  /** The same controls with the speed ladder collapsed into a select, for
   *  the phone layout where four speed buttons can't sit beside a view
   *  switch. Which of the two shows, and where, is this component's
   *  decision — the caller hands over both and never learns which was
   *  used. */
  simControlsCompact: ReactNode;
  /** Select/Way/Station/Facility — the drawing-tool palette. */
  modeToolbar: ReactNode;
  /** A background import's live status (ImportProgressPill) — stacked
   *  directly above modeToolbar in the same centered column, sharing its
   *  responsive positioning (the mobile pb-14 lift above the bottom sheet,
   *  the sheet-expanded fade) rather than guessing its own fixed offset.
   *  Null/undefined when nothing's importing. */
  importStatus?: ReactNode;
  /** Contextual desktop installation invite. It occupies the Workbench's
   *  top-chrome flow, so changing toolbar height can only push it down. */
  installBanner?: ReactNode;
}

/**
 * THE single owner of where every floating card sits over the full-bleed
 * map, at every viewport width — desktop's docked corner cards and
 * mobile's bottom sheet are two responsive layouts of the same seven slots
 * above, with only the active layout mounted. CSS-hiding both copies left
 * every hidden panel subscribed to the editor and doubled validation/list
 * work on each drag. (This replaced an earlier version of this idea split
 * across App.tsx + a separate AppShell.tsx + this file, coordinating
 * through matching classNames a card had to remember to carry — confirmed
 * live, that indirection was exactly how a panel ended up rendered nowhere
 * near the edge it was supposed to dock to, no compiler error anywhere.
 * Callers hand this component fully-formed pieces (a toolbar, a view
 * switcher, …); it never reaches back into what any of them mean.
 *
 * Deliberately NOT given the map itself as a prop: App.tsx's Hide-UI toggle
 * fades this whole component out (see its own data-ui-state wrapper), and
 * the map must never be part of that — it stays fully visible/interactive
 * with the chrome hidden, not fade with it. So the map renders as this
 * component's own sibling in App.tsx, unaffected by whatever this does.
 */
export function Workbench({
  brand,
  menuPanel,
  supplementalPanel,
  hasSupplementalContent,
  primaryToolbar,
  viewSwitcher,
  simControls,
  simControlsCompact,
  modeToolbar,
  importStatus,
  installBanner,
}: WorkbenchProps) {
  const mobile = useMobileLayout();
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const clearSelection = useEditor((s) => s.select);
  const backToSelectTool = useEditor((s) => s.setTool);
  // Only for `inert` below — CSS attribute selectors (see app.css's
  // ".zen-cluster") handle every visual part of the collapse on their own;
  // `inert` isn't expressible in CSS, so it's the one thing that still
  // needs uiHidden read directly here rather than falling out of a class.
  const { uiHidden } = useUi();
  const actionsCollapsedRef = useInertRef<HTMLDivElement>(uiHidden);
  const supplementalRef = useInertRef<HTMLDivElement>(uiHidden);
  const actionsFullRef = useInertRef<HTMLDivElement>(uiHidden);
  const sheetRef = useInertRef<HTMLDivElement>(uiHidden);
  const actionsSlotRef = useRef<HTMLDivElement | null>(null);
  const toolbarFit = useToolbarFit(actionsSlotRef, actionsFullRef, mobile);

  useEffect(() => {
    if (hasSupplementalContent) setSheetExpanded(true);
  }, [hasSupplementalContent]);

  const showingSupplemental = hasSupplementalContent;

  return (
    <>
      {/* The overlay grid: empty cells (most of the map) let clicks fall
          straight through to it; only cells with a real card in them
          intercept — the standard "controls float over a canvas" trick. */}
      <div
        className={`pointer-events-none absolute inset-2 ${mobile ? '' : 'grid gap-2'}`}
        style={{
          gridTemplateColumns: 'auto 1fr auto',
          gridTemplateRows: `auto auto 1fr var(--controls-clearance)`,
        }}
      >
        {/* ---- mobile-only top bar (desktop folds brand into the menu
            panel's own header, and viewSwitcher/primaryToolbar into their
            own docked cards instead — see below). A flex row divides the
            width between the two clusters instead of guessing a max-width
            constant for the right one — the same trap the old AppShell hit.
            The right cluster scrolls horizontally rather than wrapping,
            since it has more buttons than a phone's width can ever show in
            one row. ---- */}
        {/* Mobile renders the SAME brand/viewSwitcher/primaryToolbar slots as
            desktop — narrower is a LAYOUT problem: the left card stacks
            title over navigation (CSS hides the brand's non-title pieces);
            the right column is `.actions-collapsed`, whose CSS keeps only
            the primary actions and reveals the ⋯ overflow that carries the
            rest (see TopBarActions). */}
        {mobile && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-2">
            <div className="flex w-full items-start justify-between gap-2">
              <div className="top-chrome-card pointer-events-auto min-w-0 flex-1 overflow-hidden px-2 py-1.5">
                <div className="mobile-topleft">
                  <div className="mobile-topleft-row">{brand}</div>
                  {viewSwitcher}
                  {simControlsCompact}
                </div>
              </div>
              <div
                ref={actionsCollapsedRef}
                className="actions-collapsed top-chrome-card zen-cluster pointer-events-auto flex shrink-0 flex-col items-center gap-1 p-1"
              >
                {primaryToolbar}
              </div>
            </div>
          </div>
        )}

        {/* ---- desktop-only docked cards. The workspace panel and the
            supplemental panel are the two that genuinely want a grid cell:
            both are full-height columns pinned to an edge. Everything that
            needs to sit CENTERED on the map is laid out as a flex row
            instead (see below) — a 3-column "auto 1fr auto" track centers
            within the leftover middle track, which is the true screen center
            only when both side columns happen to match width, and they
            almost never do. ---- */}
        {!mobile && (
          <>
            <div
              className="menu-card-slot pointer-events-auto flex self-stretch justify-self-start"
              style={{ gridArea: '1 / 1 / 5 / 2' }}
            >
              <MenuCard brand={brand}>{menuPanel}</MenuCard>
            </div>
            {showingSupplemental && (
              <div
                ref={supplementalRef}
                className="zen-cluster pointer-events-auto flex self-stretch justify-self-end"
                style={{ gridArea: '3 / 3 / 4 / 4' }}
              >
                {supplementalPanel}
              </div>
            )}
          </>
        )}

        {/* ---- the top row: spacer | view | simulation | actions.
            ONE flex row whose children are siblings, so the browser sizes
            them against each other and no two can ever overlap. That is the
            whole reason this is a row rather than independently positioned
            things: the centered group used to be absolutely positioned across
            the full width, which made it free to grow straight over the
            actions card — and "how wide is the actions card" is not something
            CSS elsewhere can know, so guarding it with a max-width constant
            was guessing (it guessed 280px; the card is 446px, and it covered
            three buttons).

            Both side children are `flex-1` from a zero basis, so they take
            equal space and the middle pair sits on the MAP's center — the
            thing the old absolute positioning was for, kept. The left one
            carries a min-width mirroring the workspace panel beneath it, and
            the right one can't shrink below the actions bar's own content
            width, so when they together want more than the row has, a bar
            gives up content rather than anything sliding under anything else.

            Which view you are looking at and what the simulation is doing are
            two different questions, so they are two bars rather than one with
            a divider in it. One card holding both read as a single control
            whose left half changed the right half.

            Every card here is a `.top-app-bar`, so the row has one height at
            every width and resizing it moves nothing below it.

            A real grid item in row 1, not `absolute inset-x-0 top-0` — an
            absolutely positioned grid item opts out of the grid's own track
            sizing, so row 1's `auto` height ignored this row's actual
            rendered height entirely, and row 2 (the install banner) started
            underneath it and got covered. ---- */}
        {!mobile && (
          <div
            className="pointer-events-none flex items-start gap-2"
            style={{ gridColumn: '1 / -1', gridRow: '1' }}
          >
            <div className="flex-1" style={{ minWidth: 'var(--panel-w)' }} aria-hidden="true" />
            <div className="top-app-bar top-app-bar-center top-chrome-card pointer-events-auto min-w-0">
              {viewSwitcher}
            </div>
            <div className="top-app-bar top-app-bar-center top-chrome-card pointer-events-auto min-w-0">
              {simControls}
            </div>
            <div ref={actionsSlotRef} className="flex min-w-0 flex-1 justify-end">
              <div
                ref={actionsFullRef}
                data-fit={toolbarFit}
                className="actions-full top-app-bar top-app-bar-end top-chrome-card zen-cluster pointer-events-auto min-w-0"
              >
                {primaryToolbar}
              </div>
            </div>
          </div>
        )}

        {/* The install invitation is app-level chrome, not something about
            the map underneath it, so it hangs off the right edge below the
            action bar rather than floating in the middle of the canvas. That
            edge and `--panel-w` are the Inspector's too, so when both are up
            they read as one column instead of two unrelated cards. It keeps
            its own grid row: whatever height it takes pushes the Inspector
            down rather than covering it. ---- */}
        {!mobile && installBanner && (
          <div
            className="pointer-events-auto z-[1] justify-self-end"
            style={{ gridColumn: '1 / -1', gridRow: '2', width: 'var(--panel-w)' }}
          >
            {installBanner}
          </div>
        )}

        {/* ---- tool dock: same flex-centering as the view switch above.
            The fade-while-expanded below is a MOBILE-only concern (so the
            dock doesn't sit under the sheet's own content) — sheetExpanded
            itself isn't mobile-gated (any selection sets it, desktop
            included, so the Details sheet is already open if the user
            later shrinks the window), so `mobile &&` is load-bearing here:
            without it the dock silently vanishes on desktop the moment
            anything gets selected. Confirmed live — this exact regression
            is why it is called out instead of assumed. ---- */}
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 ${
            mobile ? 'pb-14' : 'pb-0'
          }`}
        >
          {importStatus && <div className="pointer-events-auto">{importStatus}</div>}
          <div
            className={`transition-opacity duration-150 ${
              mobile && sheetExpanded
                ? 'pointer-events-none opacity-0'
                : 'pointer-events-auto opacity-100'
            }`}
          >
            {modeToolbar}
          </div>
        </div>
      </div>

      {/* ---- mobile-only bottom sheet — the one active rendering of the
          menu/supplemental panel at this breakpoint. Zen mode collapses it
          flush with the bottom edge (below its own peek height) rather than
          unmounting it — same "shrink in place" treatment as MenuCard. ---- */}
      {mobile && (
        <div
          ref={sheetRef}
          className={`absolute inset-x-0 bottom-0 z-[5] flex flex-col rounded-t-2xl border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] shadow-[var(--md-sys-elevation-level3)] transition-[max-height,opacity] duration-200 ease-[cubic-bezier(0.2,0.7,0.3,1)] ${
            uiHidden
              ? 'pointer-events-none max-h-0 overflow-hidden opacity-0'
              : sheetExpanded
                ? 'max-h-[62vh]'
                : 'max-h-14 overflow-hidden'
          }`}
        >
          <SheetHandle
            expanded={sheetExpanded}
            setExpanded={setSheetExpanded}
            title={showingSupplemental ? 'Details' : 'Workspace'}
          />
          {showingSupplemental && (
            // Whichever put supplementalPanel here — a selection, an armed
            // tool, or (rarely) both — clears both. Each is a no-op on
            // whichever wasn't actually active, so this works regardless of
            // which case is showing right now.
            <button
              type="button"
              className="sheet-back"
              onClick={() => {
                clearSelection(null);
                backToSelectTool('select');
              }}
            >
              <Icon name="chevronDown" size={15} style={{ transform: 'rotate(90deg)' }} /> Workspace
            </button>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {showingSupplemental ? supplementalPanel : menuPanel}
          </div>
        </div>
      )}
    </>
  );
}

interface MenuCardProps {
  brand: ReactNode;
  children: ReactNode;
}

/** Desktop's menu card: brand header + collapsible workspace body — sized to
 *  its content (not stretched full-height) so collapsing the workspace actually
 *  shrinks the card instead of leaving a tall empty rectangle below it. */
function MenuCard({ brand, children }: MenuCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { uiHidden } = useUi();
  const cardRef = useRef<HTMLElement | null>(null);
  const openWidthRef = useRef(0);
  const collapsedWidthRef = useRef(0);

  // Mirrors the open width on every render where the card IS open, so
  // it's available the instant zen mode engages without racing React's
  // own commit of the [data-zen] attribute — by the time the effect below
  // runs, that attribute (and app.css's [data-zen] .menu-card rule) has
  // already landed, so measuring "what was the open width" AT that point
  // would already read the collapsed value. Reading it one render ago,
  // here, sidesteps that entirely.
  useLayoutEffect(() => {
    if (!uiHidden && cardRef.current?.style.width === '') {
      openWidthRef.current = cardRef.current.getBoundingClientRect().width;
    }
  });

  // Width cannot transition to or from `auto`. Keep the two measured numeric
  // endpoints and give the browser one painted frame at the starting width
  // before assigning the destination. Without that frame, closing commits its
  // final width before paint and appears to snap even though CSS has a
  // transition.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const measureNaturalWidth = () => {
      const prev = el.style.width;
      el.style.width = 'auto';
      const w = el.getBoundingClientRect().width;
      el.style.width = prev;
      return w;
    };

    let targetWidth: number;
    if (uiHidden) {
      collapsedWidthRef.current = measureNaturalWidth();
      el.style.width = `${openWidthRef.current}px`;
      targetWidth = collapsedWidthRef.current;
    } else if (collapsedWidthRef.current > 0) {
      el.style.width = `${collapsedWidthRef.current}px`;
      targetWidth = openWidthRef.current;
    } else {
      el.style.width = '';
      return;
    }

    const brandEl = el.querySelector('.panel-brand');
    let ro: ResizeObserver | null = null;
    let targetFrame = 0;
    const startFrame = requestAnimationFrame(() => {
      targetFrame = requestAnimationFrame(() => {
        el.style.width = `${targetWidth}px`;
        if (uiHidden && brandEl) {
          ro = new ResizeObserver(() => {
            collapsedWidthRef.current = measureNaturalWidth();
            el.style.width = `${collapsedWidthRef.current}px`;
          });
          ro.observe(brandEl);
        }
      });
    });

    const releaseOpenWidth = (event: TransitionEvent) => {
      if (!uiHidden && event.propertyName === 'width') el.style.width = '';
    };
    el.addEventListener('transitionend', releaseOpenWidth);

    return () => {
      cancelAnimationFrame(startFrame);
      cancelAnimationFrame(targetFrame);
      ro?.disconnect();
      el.removeEventListener('transitionend', releaseOpenWidth);
    };
  }, [uiHidden]);

  return (
    <Panel ref={cardRef} slot="left" className="menu-card" aria-label="System workspace">
      <div className="panel-brand">
        <div className="panel-brand-row">{brand}</div>
      </div>
      <div className="panel-head">
        <IconButton
          icon="chevronDown"
          size={16}
          iconStyle={{ transform: collapsed ? 'rotate(-90deg)' : undefined }}
          label={collapsed ? 'Expand' : 'Collapse'}
          onClick={() => setCollapsed((c) => !c)}
        />
        <span className="panel-head-title">Workspace</span>
      </div>
      <div className={`collapsible ${collapsed ? 'collapsed' : ''}`}>
        <div className="collapsible-inner">{children}</div>
      </div>
    </Panel>
  );
}

interface SheetHandleProps {
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  title: string;
}

function SheetHandle({ expanded, setExpanded, title }: SheetHandleProps) {
  const dragStartY = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    dragStartY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const startY = dragStartY.current;
    dragStartY.current = null;
    if (startY === null) return;
    const dy = e.clientY - startY;
    // A real drag (past a small slop) sets the state explicitly by
    // direction and swallows the click that follows; a short tap falls
    // through to onClick so keyboard activation keeps working too.
    if (Math.abs(dy) > 24) {
      setExpanded(dy < 0);
      suppressClick.current = true;
    }
  };
  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setExpanded((v) => !v);
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
      <Icon
        name="chevronDown"
        size={16}
        style={{ transform: expanded ? undefined : 'rotate(180deg)' }}
      />
    </button>
  );
}
