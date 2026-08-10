import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useEditor } from '../editor/EditorProvider';
import { useCompactLayout } from '../device/capabilities';
import { useMediaQuery } from '../device/media-query';
import { useKeyboardInset } from './useKeyboardInset';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Panel } from './Panel';
import { useInertRef } from './useInertRef';
import { useUi } from './UiProvider';
import { useView, type ViewMode } from './ViewProvider';

/**
 * Whether the top row can afford the wide rendering of the view switch and
 * the simulation transport.
 *
 * A content-fit threshold, not a layout boundary — the same species as the
 * 860/620/339 ones in app.css, and deliberately not --breakpoint-md. It is
 * arithmetic over things that do not change: the workspace panel's reserved
 * 280px, the segmented view switch's 254px, the simulation bar's 337px, the
 * action bar's own narrowest step at 178px, three 8px gaps and the overlay's
 * 16px inset come to 1089.
 *
 * Below it the two bars used to overflow and, because `.top-app-bar` scrolls
 * with `scrollbar-width: none`, they did it silently. Measured at 768px:
 * "Diagram" rendered 0 of its 63px and the clock 0 of its 100px, with no
 * scrollbar, fade or arrow to say so. That band covered iPad in both
 * orientations and every phone held sideways.
 *
 * Re-measure this if a control is added to either bar. `.top-app-bar` keeps
 * its `overflow-x: auto` as a backstop so a miss here degrades to a scroll
 * rather than to something unreachable.
 */
const ROOMY_TOP_ROW_QUERY = '(min-width: 1089px)';

/** What the one dynamic surface is showing. Mirrors Inspector's
 *  SupplementalContent union, narrowed to what layout needs to know. */
export type SupplementalKind = 'none' | 'selection' | 'tool-draft';

/**
 * How far the compact workbench is open.
 *
 * Three stops, not two. The old sheet had a 56px peek and a 62dvh open, and
 * anything worth showing jumped straight to the taller one — so arming a
 * drawing tool, which shows that tool's options, buried the map you were
 * about to draw on. Measured at 390x844 that left 155px of map, 18% of the
 * screen, with the line you were drawing underneath the panel.
 *
 * `half` is what a selection wants: enough to read and edit an object while
 * still seeing it. `full` is what a long list wants, and you ask for it.
 */
export type Detent = 'closed' | 'half' | 'full';

const DETENTS: Detent[] = ['closed', 'half', 'full'];

const OUTLINE_TITLE: Record<ViewMode, string> = {
  network: 'Network outline',
  infrastructure: 'Infrastructure outline',
  diagram: 'Diagram outline',
};

/** The stop a newly-shown panel opens to. Arming a tool is something you did
 *  in order to work ON the map, so it announces itself in the handle and
 *  stays out of the way; selecting an object is something you did in order to
 *  look at the object. */
export function detentFor(kind: SupplementalKind): Detent | null {
  if (kind === 'selection') return 'half';
  if (kind === 'tool-draft') return 'closed';
  return null;
}

/** How much of the action bar's content fits. Each step is narrower than the
 *  one before it, so the first that fits is the most complete that fits.
 *  app.css owns what each one drops, keyed off `[data-fit]`. */
type ToolbarFit = 'full' | 'labels' | 'tertiary' | 'overflow';

/** Widest first. `full` gives up nothing, so it is the only one app.css has no
 *  rule for; tests/ui/toolbar-fit-steps.test.ts holds the two sides together. */
export const TOOLBAR_FITS: ToolbarFit[] = ['full', 'labels', 'tertiary', 'overflow'];

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

    // Pricing a step means writing it, forcing layout, and reading the width
    // back, so this runs on every resize frame of a window drag. Price the
    // narrowest step (the floor below), then walk from the widest and stop at
    // the first that fits: two measurements in the steady state, where the bar
    // has room and nothing changes, rather than one per step every frame.
    const measure = () => {
      const rendered = el.dataset.fit;
      const priceOf = (candidate: ToolbarFit) => {
        el.dataset.fit = candidate;
        return naturalWidth(el);
      };
      const narrowest = TOOLBAR_FITS[TOOLBAR_FITS.length - 1];

      // The narrowest step is the floor the row must respect. Without it the
      // container keeps taking its share of a shrinking row and the bar ends
      // up scrolling its own ⋯ button out of reach; with it, the
      // canvas-state bar beside it gives way instead.
      const floor = `${Math.ceil(priceOf(narrowest))}px`;
      if (box.style.minWidth !== floor) box.style.minWidth = floor;

      // Read after the floor lands: applying it is what widens the container
      // in the case the floor exists for.
      const available = box.clientWidth;
      let chosen = narrowest;
      for (const candidate of TOOLBAR_FITS) {
        if (priceOf(candidate) <= available) {
          chosen = candidate;
          break;
        }
      }

      if (rendered === undefined) delete el.dataset.fit;
      else el.dataset.fit = rendered;
      setFit(chosen);
    };

    measure();
    // Writing the floor from inside the callback can resize the very element
    // being observed, which is the shape that produces "ResizeObserver loop
    // completed with undelivered notifications". It settles in one extra
    // notification and cannot run away: the floor only widens the container
    // when the container was narrower than it, and the pass that follows finds
    // the same floor, writes nothing, and picks the same step.
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
   *  which through useCompactLayout(), which shares its boundary with
   *  Tailwind's md breakpoint, not the caller. */
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
  /** What supplementalPanel is showing right now, if anything. Drives the
   *  compact sheet's List⇄Details toggle, and — because the two mean
   *  different things about how much of the map you still need — how far the
   *  workbench opens for it. Mirrors Inspector's SupplementalContent without
   *  taking a dependency on it. */
  supplemental: SupplementalKind;
  /** Undo/redo/export/share/issues/layers/keyboard — the transient-action
   *  cluster, distinct from viewSwitcher (persistent canvas state). */
  primaryToolbar: ReactNode;
  /** Network/Infrastructure/Diagram — a persistent view state, not a
   *  transient action, so it's its own slot rather than folded into
   *  primaryToolbar (desktop only has room to show this distinction). */
  viewSwitcher: ReactNode;
  /** The same switch as one labelled button, for rows too narrow for three
   *  labels side by side. Which of the two shows is this component's
   *  decision, exactly as it is for the two simulation renderings below —
   *  the caller hands over both and never learns which was used. */
  viewSwitcherCompact: ReactNode;
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
  supplemental,
  primaryToolbar,
  viewSwitcher,
  viewSwitcherCompact,
  simControls,
  simControlsCompact,
  modeToolbar,
  importStatus,
  installBanner,
}: WorkbenchProps) {
  // Layout size and pointer precision stay independent.
  const mobile = useCompactLayout();
  // Always call the narrower top-row query; short-circuiting it changes hook order.
  const roomyTopRow = useMediaQuery(ROOMY_TOP_ROW_QUERY);
  const compactTopRow = mobile || !roomyTopRow;
  const viewSwitch = compactTopRow ? viewSwitcherCompact : viewSwitcher;
  const [detent, setDetent] = useState<Detent>('closed');
  const clearSelection = useEditor((s) => s.select);
  const backToSelectTool = useEditor((s) => s.setTool);
  // CSS handles the visual collapse; React owns the non-visual inert state.
  const { uiHidden } = useUi();
  const { viewMode } = useView();
  // Only the sheet reacts to the keyboard; the docked desktop cards are not
  // bottom-anchored and no desktop keyboard covers the viewport.
  const keyboardInset = useKeyboardInset();
  const actionsCollapsedRef = useInertRef<HTMLDivElement>(uiHidden);
  const supplementalRef = useInertRef<HTMLDivElement>(uiHidden);
  const actionsFullRef = useInertRef<HTMLDivElement>(uiHidden);
  const sheetRef = useInertRef<HTMLDivElement>(uiHidden);
  const actionsSlotRef = useRef<HTMLDivElement | null>(null);
  const toolbarFit = useToolbarFit(actionsSlotRef, actionsFullRef, mobile);

  useEffect(() => {
    const opening = detentFor(supplemental);
    if (opening) setDetent(opening);
  }, [supplemental]);

  const showingSupplemental = supplemental !== 'none';

  return (
    <>
      {/* ---- the compact layout's top bar.
          ANCHORED, not floating: full-bleed, flush to the top edge, a
          hairline rule instead of a shadow, and no corner radius. It sits
          outside the inset overlay below because an 8px margin is exactly
          what stops a bar reading as part of the screen rather than as a
          card dropped on it.

          That is the whole reason this is one row. The three floating cards
          it replaces — a 322x128 slab holding the system name, the view
          switch and the simulation clock stacked, plus a 44x158 column of
          icons beside it — covered the top 166px of a 390x844 screen and
          disagreed with each other about padding (6px vs 4px), which left
          their first icons 2px out of line and their bottom edges 30px
          apart.

          The simulation moves to the workbench with the tool rail: it is
          canvas state, it belongs with the other canvas state, and a new
          system with no schedule should not spend a permanent row on a
          clock that reports nothing. ---- */}
      {mobile && (
        <div
          // viewport-fit=cover extends the viewport under the notch and the
          // status bar, so the bar needs that inset back as padding or its
          // contents sit beneath them. Zero on every device without one.
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
          className="compact-top-bar zen-cluster"
          ref={actionsCollapsedRef}
        >
          <div className="compact-top-bar-row">
            {brand}
            {viewSwitch}
            <div className="actions-collapsed">{primaryToolbar}</div>
          </div>
        </div>
      )}
      {mobile && uiHidden && <ZenRestore />}

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
            <div className="top-app-bar top-app-bar-center top-chrome-card zen-collapse-bar pointer-events-auto min-w-0">
              {viewSwitch}
            </div>
            <div className="top-app-bar top-app-bar-center top-chrome-card pointer-events-auto min-w-0">
              {compactTopRow ? simControlsCompact : simControls}
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

        {/* ---- tool dock, floating over the map's bottom edge. Desktop
            only: the compact layout puts the same toolbar inside the
            workbench instead, pinned to its bottom edge, where it cannot be
            covered by the panel above it.

            It used to be here at every width, faded out whenever the
            compact sheet expanded. That fade is why choosing a tool — which
            expands the sheet to show that tool's options — took every tool,
            both zoom buttons and the attribution off the screen at once:
            nine of nine map-surface controls, none reachable, with no
            prompt to collapse the sheet first. ---- */}
        {!mobile && (
          <div className="dock-slot pointer-events-none absolute bottom-0 flex flex-col items-center gap-2">
            {importStatus && <div className="pointer-events-auto">{importStatus}</div>}
            <div className="pointer-events-auto">{modeToolbar}</div>
          </div>
        )}
      </div>

      {/* ---- the compact layout's workbench: the bottom half of the same
          anchored frame the top bar starts.

          ONE surface holding three things, in this order from its top edge
          down: a drag handle naming what is showing, the contextual panel,
          and — pinned to the bottom, outside the panel's scroll — the tool
          rail and the simulation transport.

          The rail lives in here rather than floating over the map because
          that is what makes it impossible to cover. Nothing in this surface
          can occlude anything else in it: growing the panel moves the rail
          down the DOM, not on top of it. It also puts the controls you use
          most within a thumb's reach of the bottom edge, which is where a
          hand actually is.

          Zen mode collapses it flush rather than unmounting it, so the
          panel's scroll position and the sheet's own state survive. ---- */}
      {mobile && (
        <div
          ref={sheetRef}
          // bottom is the keyboard's height when one is open, so the
          // workbench rides above it instead of being typed into from
          // behind; it is the home-indicator inset otherwise, since
          // viewport-fit=cover put the viewport's bottom edge underneath the
          // indicator. Padding rather than a margin, so the surface still
          // reaches the edge.
          style={{
            bottom: keyboardInset > 0 ? keyboardInset : undefined,
            paddingBottom: keyboardInset > 0 ? undefined : 'env(safe-area-inset-bottom, 0px)',
          }}
          className={`compact-workbench ${uiHidden ? 'is-hidden' : `is-${detent}`}`}
        >
          <SheetHandle
            detent={detent}
            setDetent={setDetent}
            title={showingSupplemental ? 'Details' : OUTLINE_TITLE[viewMode]}
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
              <Icon name="chevronDown" size={15} style={{ transform: 'rotate(90deg)' }} />{' '}
              {OUTLINE_TITLE[viewMode]}
            </button>
          )}
          <div className="workbench-panel">
            {showingSupplemental ? supplementalPanel : menuPanel}
          </div>
          {importStatus && <div className="workbench-status">{importStatus}</div>}
          {/* Outside .workbench-panel's scroll on purpose: these are the
              persistent controls, and they stay put while the panel above
              them scrolls. */}
          <div className="workbench-rail zen-cluster">
            <div className="workbench-rail-sim">{simControlsCompact}</div>
            {modeToolbar}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Zen mode's way back on a compact screen.
 *
 * The Hide-UI toggle used to sit permanently in the top bar for this reason
 * alone — it was the only control that survived its own collapse. That cost
 * 34px of the second-most-prominent position in the bar, every session,
 * for something used once. This costs nothing until the chrome is actually
 * hidden.
 */
function ZenRestore() {
  const { toggleUi } = useUi();
  return (
    <button type="button" className="zen-restore" onClick={toggleUi} aria-label="Show UI (\)">
      <Icon name="sidebar" size={18} />
    </button>
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
  const { viewMode } = useView();
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
    <Panel ref={cardRef} slot="left" className="menu-card" aria-label={OUTLINE_TITLE[viewMode]}>
      <div className="panel-brand">
        <div className="panel-brand-row">{brand}</div>
      </div>
      <div className="panel-head">
        <span className="panel-head-title">{OUTLINE_TITLE[viewMode]}</span>
        <IconButton
          icon={collapsed ? 'panelOpen' : 'sidebar'}
          size={16}
          label={collapsed ? 'Show outline' : 'Hide outline'}
          onClick={() => setCollapsed((c) => !c)}
        />
      </div>
      <div className={`collapsible ${collapsed ? 'collapsed' : ''}`}>
        <div className="collapsible-inner">{children}</div>
      </div>
    </Panel>
  );
}

interface SheetHandleProps {
  detent: Detent;
  setDetent: (v: Detent | ((prev: Detent) => Detent)) => void;
  title: string;
}

/** One stop along, in whichever direction, clamped at the ends. */
export function step(from: Detent, direction: 1 | -1): Detent {
  const next = DETENTS.indexOf(from) + direction;
  return DETENTS[Math.min(DETENTS.length - 1, Math.max(0, next))];
}

function SheetHandle({ detent, setDetent, title }: SheetHandleProps) {
  const dragStartY = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const expanded = detent !== 'closed';

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    dragStartY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const startY = dragStartY.current;
    dragStartY.current = null;
    if (startY === null) return;
    const dy = e.clientY - startY;
    // A real drag (past a small slop) moves ONE stop in the direction it
    // went, and swallows the click that follows; a short tap falls through
    // to onClick so keyboard activation keeps working too.
    //
    // One stop per drag rather than a distance-to-nearest-stop calculation:
    // the surface does not follow the finger (its height is a CSS
    // transition, not a live drag), so a gesture that skipped a stop would
    // land somewhere the user has no way to predict from what they saw.
    if (Math.abs(dy) > 24) {
      setDetent((current) => step(current, dy < 0 ? 1 : -1));
      suppressClick.current = true;
    }
  };
  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    // Tapping is the two-state gesture it always was: open to the middle
    // stop, or close. `full` is a drag away, deliberately — it covers most
    // of the map, so it should take a deliberate gesture.
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
      <Icon
        name="chevronDown"
        size={16}
        style={{ transform: expanded ? undefined : 'rotate(180deg)' }}
      />
    </button>
  );
}
