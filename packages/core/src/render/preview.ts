import { MODE_ORDER, WAY_TYPE_ORDER } from '../model/catalog';
import { systemBounds } from '../model/geo';
import type { LngLat, TransitSystem } from '../model/system';
import type { ViewOptions } from './buildFeatures';
import { legendEntriesFor } from './legend';
import { fitBounds, metersPerPixel, projector } from './project';
import { scaleBarFor } from './scaleBar';
import { systemSvg } from './svg';
import { LVBT, LVBT_FONT_FAMILY } from '../style/lvbtBrand';

// What a shared system looks like when something outside the app has to show
// it: a link unfurl in Slack, an oEmbed thumbnail, the no-script fallback of
// an embedded map. Pure — the Worker adds fonts and rasterizes, but the
// picture itself is decided here, so it can be exercised without a Worker.

/** Open Graph's standard card size — the pixel dimensions of the PNG we
 *  serve, and what the meta tags advertise. */
export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 630;

/**
 * The card is *composed* at half the size it's *rasterized* at, and resvg
 * scales it up 2x. Nothing about the drawing changes; the whole viewport is
 * half as wide, so every font size and line weight covers twice as much of the
 * finished card. That's what makes an unfurl readable, and it's one number
 * rather than a parallel set of card-sized constants to keep in sync.
 */
const CARD_SVG_WIDTH = PREVIEW_WIDTH / 2;
const CARD_SVG_HEIGHT = PREVIEW_HEIGHT / 2;

/**
 * Roughly how wide chat clients actually render a large link preview. Slack
 * and Discord land near this in a default-width desktop column, and narrower
 * on mobile. It's an estimate, and it only has to be right to within a factor
 * that doesn't move anything across the legibility threshold.
 */
const TYPICAL_UNFURL_WIDTH = 460;

// The card's surface. A preview always lands on a background nobody controls
// — a chat client's light or dark theme — and the image itself can't adapt,
// since a crawler fetches one PNG with no idea who'll see it. So the card
// carries its own ground and edge: on a light background it stops being an
// edgeless white bleed, and on a dark one it reads as a deliberate plate
// rather than a glaring slab.
//
// A share card is the most public artifact this project produces — it goes out
// into other people's feeds carrying the org's name — so it is the org's brand
// (see style/lvbtBrand.ts), read from tokens rather than restated as hex here.
// The ink rule is not a heavy-handed choice: the brand defines both
// --color-outline and --color-outline-variant as ink on light surfaces.
const CARD_BACKGROUND = LVBT.light.surface;
const CARD_BORDER_COLOR = LVBT.light.outline;
// Values are in composed units, which are half the finished PNG's pixels — so
// a 4 here is an 8px rule on the 1200px card, landing around 3px once a chat
// client scales it down. Thin enough to read as a frame, heavy enough to
// survive that scaling.
const CARD_BORDER_WIDTH = 4;
/** Margin of bare paper outside the rule, so it frames the card rather than
 *  looking like the image was cropped at its own edge. */
const CARD_BORDER_INSET = 12;
/** The framed area is a panel sitting on the base surface, and the brand has a
 *  separate token for exactly that ("Raised surface — use for cards, panels,
 *  grouped tools"). Using base surface for both would flatten the frame back
 *  into a single field of colour. */
const CARD_INSET_BACKGROUND = LVBT.light.surfaceContainer;

// Breathing room between the system and the card edge. Has to clear the
// framed rule (inset + stroke) as well, or lines run straight through it.
const PREVIEW_PADDING = 34;

// A preview is a whole-system portrait, so nothing is filtered out. Network
// view specifically: the schematic is what reads at card size, where
// lane-level infrastructure detail would just be noise.
const PREVIEW_VIEW: ViewOptions = {
  viewMode: 'network',
  visibleModes: new Set(MODE_ORDER),
  visibleWayTypes: new Set(WAY_TYPE_ORDER),
};

// An empty system has no extent to frame. Showing the whole world beats
// failing — the card still carries the title and reads as a real, if empty,
// map.
const EMPTY_SYSTEM_CENTER: LngLat = [0, 20];
const EMPTY_SYSTEM_ZOOM = 1;

/** The brand face, named bare rather than as a fallback stack: resvg has no
 *  system fonts to fall back *to*, so the Worker bundles exactly this one (see
 *  the Worker's own preview.ts) and the markup has to ask for it by name. */
export const PREVIEW_FONT_FAMILY = LVBT_FONT_FAMILY;

export interface PreviewSvgOptions {
  width?: number;
  height?: number;
  /** How wide this will be seen. Defaults to a typical chat-client unfurl;
   *  pass the real width when it's known (an oEmbed consumer that told us its
   *  maxwidth, say) and the drawing adjusts its own detail accordingly. */
  displayWidth?: number;
  /** Defaults true — a preview is normally shown by something that prints the
   *  system's name beside it. Pass false for a standalone use (an image
   *  someone saves and drops into a slide) so it carries its own title. */
  captionedExternally?: boolean;
  /** Surface overrides. A preview always lands on a background we don't
   *  control, so it has card defaults rather than the renderer's bare ones. */
  background?: string;
  borderColor?: string;
  borderWidth?: number;
  borderInset?: number;
  insetBackground?: string;
}

/**
 * The preview as SVG. Rasterize it for `og:image` (unfurlers reject SVG), or
 * serve it as-is where a vector is strictly better — an embed's no-script
 * fallback, say.
 *
 * This is a preset, not a second renderer: it states two facts about how the
 * result will be presented — how wide it gets seen, and that the surface
 * showing it captions itself — and `systemSvg` decides everything else from
 * there. What's left is the network and nothing else: stop labels, the
 * scale bar and the north arrow fall below legibility at unfurl size, and the
 * title and legend would only repeat the text Slack already puts beside the
 * image. Nothing here asks for a single element to be removed.
 */
export function previewSvg(system: TransitSystem, opts: PreviewSvgOptions = {}): string {
  const width = opts.width ?? CARD_SVG_WIDTH;
  const height = opts.height ?? CARD_SVG_HEIGHT;
  const bounds = systemBounds(system);
  const viewport = bounds
    ? fitBounds(bounds, { width, height, padding: PREVIEW_PADDING })
    : { center: EMPTY_SYSTEM_CENTER, zoom: EMPTY_SYSTEM_ZOOM, width, height };

  return systemSvg(system, PREVIEW_VIEW, projector(viewport), {
    title: system.name || 'Transit system',
    legend: legendEntriesFor(system, PREVIEW_VIEW),
    width,
    height,
    fontFamily: PREVIEW_FONT_FAMILY,
    displayWidth: opts.displayWidth ?? TYPICAL_UNFURL_WIDTH,
    captionedExternally: opts.captionedExternally ?? true,
    background: opts.background ?? CARD_BACKGROUND,
    borderColor: opts.borderColor ?? CARD_BORDER_COLOR,
    borderWidth: opts.borderWidth ?? CARD_BORDER_WIDTH,
    borderInset: opts.borderInset ?? CARD_BORDER_INSET,
    insetBackground: opts.insetBackground ?? CARD_INSET_BACKGROUND,
    scaleBar: scaleBarFor(metersPerPixel(viewport), Math.min(140, width * 0.3)),
  });
}
