import type { Feature, LineString, Point } from "geojson";
import type { LngLat, TransitSystem } from "../model/system";
import { buildFeatures, type ViewOptions } from "./buildFeatures";
import type { LegendEntry } from "./legend";
import type { ScaleBarSpec } from "./scaleBar";
import type { ScreenPoint } from "./project";
import { LVBT, LVBT_FONT_STACK } from "../style/lvbtBrand";

// The vector composition of a finished map: system geometry, plus the
// furniture (title, legend, north arrow, scale bar) that makes an exported
// image read as a map on its own rather than an extracted line drawing.
//
// This takes a `project` callback rather than a MapLibre Map, which is the
// whole point of it living in core: the app passes MapLibre's own bound
// project() so an export matches what the user framed on screen, and the
// Worker passes the pure projector from render/project.ts so it can draw a
// stored system with no map and no DOM at all.

// Brand ink and paper. These used to be hand-picked near-black/near-white
// values; anything this module draws can end up in someone else's feed under
// the org's name, so it uses the org's real tokens.
const INK = LVBT.light.onSurface;
const PAPER = LVBT.light.surface;
/** Backing for the title and legend panels — brand paper, not white. */
const PANEL_FILL = "rgba(247, 244, 236, 0.88)";
const PAD = 20;
const TITLE_INSET = 14; // left/optical inset of the title inside its band
const SWATCH = 14;
const ROW_H = 22;

// Authored type sizes. Each is also what the legibility rule below tests, so
// changing one changes both how big the text is and the size at which it stops
// being worth drawing — which is the point: they're the same question.
const TITLE_SIZE = 22;
const STATION_LABEL_SIZE = 12;
const LEGEND_TEXT_SIZE = 13;
const FURNITURE_TEXT_SIZE = 11; // facility labels, scale-bar label, the "N"

// Most of the drawing a legend may cover before it stops being a caption and
// starts being the subject.
const LEGEND_MAX_HEIGHT_FRACTION = 0.55;

export interface SvgRenderOptions {
  title: string;
  legend: LegendEntry[];
  width: number;
  height: number;
  /** Map rotation in degrees, for the north arrow. Server-rendered output is
   *  always north-up, so this defaults to 0. */
  bearing?: number;
  /** Omit to draw no scale bar — a caller with no meaningful ground
   *  resolution (or no room for one) shouldn't have to fake one. */
  scaleBar?: ScaleBarSpec;
  /** Fill behind the whole drawing — the outermost ground, including the
   *  margin outside any framing rule. */
  background?: string;
  /**
   * Fill for the framed area inside the border, when `borderInset` leaves one.
   * A framed panel is a raised surface sitting on the base one, and the brand
   * has separate tokens for those two things; using one colour for both throws
   * away the distinction the frame exists to make.
   *
   * Omit to leave the framed area on the same ground as everything else.
   */
  insetBackground?: string;
  /**
   * Draws an edge around the surface. Matters whenever the image is shown
   * inside something we don't control: a chat unfurl sits on whatever colour
   * that client's theme happens to be, and an edgeless light rectangle either
   * bleeds into a light background or glares against a dark one. An exported
   * file going into a document usually wants no edge, so this defaults to
   * none.
   *
   * Deliberately a square edge. Rounding the corners here would bake the
   * background colour into the corner pixels — which looks like damage the
   * moment the image lands on a dark background — and clients that want
   * rounded cards round them themselves.
   */
  borderColor?: string;
  borderWidth?: number;
  /**
   * Pulls the border in from the edge of the drawing, leaving a margin of bare
   * surface outside it. Turns the edge from a crop line into a deliberate
   * frame, and gives the whole card a mat.
   *
   */
  borderInset?: number;
  /** SVG font-family for every label. The browser can name generic families
   *  and let the OS resolve them; a Worker cannot — resvg only knows the font
   *  buffers it was handed, so it must be told exactly which one to use. */
  fontFamily?: string;
  /**
   * How wide this drawing will actually be *seen*, in CSS pixels — which is
   * often not how wide it was drawn. A share-link unfurl is composed at card
   * size but rendered by Slack into a column a third as wide; an exported SVG
   * is usually looked at close to full size.
   *
   * Everything detail-related derives from this one number (see `legible`
   * below) instead of from per-element flags, for the same reason the
   * Infrastructure view derives lane detail from zoom: what belongs in a
   * drawing is a function of how big it comes out, not of who asked for it.
   * Defaults to `width` — "assume it's viewed at the size it was drawn."
   */
  displayWidth?: number;
  /**
   * True when whatever is showing this image already displays the system's
   * name and summary as text of its own — a chat client's link unfurl, an
   * oEmbed consumer's caption. Burning a title and legend into the image then
   * just says the same thing twice, in worse type, using space the map wants.
   *
   * A downloaded export has nothing captioning it, so it defaults to false and
   * keeps carrying its own title.
   */
  captionedExternally?: boolean;
}

// The org's brand face (see style/lvbtBrand.ts). Server-side rendering
// resolves it from a bundled subset; in a browser the fallbacks in the stack
// cover the moment before the webfont lands.
const DEFAULT_FONT_FAMILY = LVBT_FONT_STACK;

// Below roughly this many displayed pixels, text stops being read and starts
// being visual noise — the reader sees grey mush where a station name was.
// Anything that can't clear it is better left out than drawn illegibly.
const MIN_LEGIBLE_PX = 10;

// Label placement with collision avoidance.
//
// MapLibre resolves overlapping labels on the live map; this composition never
// had an equivalent, so a dense system printed station names straight through
// each other — "North Las Vegas" crossing "South Strip" — which reads as a
// rendering fault rather than a busy map. Cartographers solve this the same
// way: try a label in a few positions around its anchor, and if none of them
// are clear, leave it off. A missing name is recoverable; an unreadable pile
// of them makes the ones underneath unreadable too.
//
// There's no DOM here to measure text with, so widths are estimated from
// character count. That's approximate, and deliberately generous: over-
// estimating drops a borderline label, which is the safer failure.

/** Rough advance width per character, as a fraction of font size. Measured
 *  against Public Sans's mixed-case average; generous rather than tight. */
const CHAR_WIDTH_RATIO = 0.58;

interface LabelBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Where a label sits relative to its anchor, in preference order: directly
 *  above (the cartographic default), then below, then out to either side. */
type LabelPlacement = "above" | "below" | "right" | "left";
const PLACEMENTS: LabelPlacement[] = ["above", "below", "right", "left"];

interface PlacedLabel {
  x: number;
  y: number;
  anchor: "middle" | "start" | "end";
  box: LabelBox;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Finds a free spot for one label, or returns null if every candidate
 * position collides with something already placed. `clearance` is the radius
 * of the marker the label belongs to, so text never sits on its own dot.
 */
function placeLabel(
  text: string,
  size: number,
  cx: number,
  cy: number,
  clearance: number,
  taken: LabelBox[],
): PlacedLabel | null {
  const w = text.length * size * CHAR_WIDTH_RATIO;
  const h = size;
  const gap = clearance + 6;

  for (const placement of PLACEMENTS) {
    let x = cx;
    let y = cy;
    let anchor: PlacedLabel["anchor"] = "middle";
    let box: LabelBox;

    if (placement === "above") {
      y = cy - gap;
      box = { left: cx - w / 2, right: cx + w / 2, top: y - h, bottom: y + h * 0.25 };
    } else if (placement === "below") {
      y = cy + gap + h * 0.8;
      box = { left: cx - w / 2, right: cx + w / 2, top: y - h, bottom: y + h * 0.25 };
    } else if (placement === "right") {
      x = cx + gap;
      y = cy + h * 0.35;
      anchor = "start";
      box = { left: x, right: x + w, top: y - h, bottom: y + h * 0.25 };
    } else {
      x = cx - gap;
      y = cy + h * 0.35;
      anchor = "end";
      box = { left: x - w, right: x, top: y - h, bottom: y + h * 0.25 };
    }

    if (!taken.some((other) => overlaps(box, other))) return { x, y, anchor, box };
  }
  return null;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function titleMarkup(title: string, width: number, fontFamily: string, size: number): string {
  if (!title.trim()) return "";
  // Rough width estimate (no DOM measurement available for a detached SVG
  // string) — generous enough that the backing panel never clips real titles.
  const bandH = size * 1.9;
  const w = Math.min(width, title.length * size * 0.62 + TITLE_INSET * 2);
  // Optically centred in its own band rather than pinned near the top of it,
  // and inset by the same amount on the left — the title used to sit high and
  // hard against the corner, which read as misplaced rather than deliberate.
  const baseline = bandH / 2 + size * 0.34;
  return (
    `<rect x="0" y="0" width="${w.toFixed(0)}" height="${bandH.toFixed(0)}" fill="${PANEL_FILL}"/>` +
    `<text x="${TITLE_INSET}" y="${baseline.toFixed(1)}" font-family="${fontFamily}" font-size="${size.toFixed(1)}" font-weight="700" fill="${INK}">${escapeXml(title)}</text>`
  );
}

function legendMarkup(legend: LegendEntry[], width: number, height: number, fontFamily: string, size: number): string {
  if (legend.length === 0) return "";
  const rowH = Math.max(ROW_H, size * 1.7);

  // A legend is a caption, not the picture. Left uncapped, a system with
  // twenty lines produces a panel taller than the drawing it's captioning and
  // runs off the top edge. Past the cap the remainder is counted rather than
  // listed — an honest "there's more here" beats silently dropping lines.
  const maxRows = Math.max(1, Math.floor((height * LEGEND_MAX_HEIGHT_FRACTION - PAD) / rowH));
  const truncated = legend.length > maxRows;
  const shown = truncated ? legend.slice(0, maxRows - 1) : legend;
  const overflow = legend.length - shown.length;
  const rowCount = shown.length + (truncated ? 1 : 0);

  const panelH = rowCount * rowH + PAD;
  const maxChars = Math.max(...legend.map((e) => e.label.length));
  const panelW = Math.min(width, SWATCH + 10 + maxChars * size * 0.58 + PAD * 2);
  const top = height - panelH;
  const rowY = (i: number) => top + PAD / 2 + i * rowH;
  const rows = shown
    .map((e, i) => {
      const y = rowY(i);
      return (
        `<rect x="${PAD}" y="${(y + (rowH - SWATCH) / 2).toFixed(1)}" width="${SWATCH}" height="${SWATCH}" fill="${e.color}"/>` +
        `<text x="${PAD + SWATCH + 10}" y="${(y + rowH / 2 + size * 0.34).toFixed(1)}" font-family="${fontFamily}" font-size="${size.toFixed(1)}" font-weight="500" fill="${INK}">${escapeXml(e.label)}</text>`
      );
    })
    .join("");
  const overflowRow = truncated
    ? `<text x="${PAD + SWATCH + 10}" y="${(rowY(shown.length) + rowH / 2 + size * 0.34).toFixed(1)}" font-family="${fontFamily}" font-size="${size.toFixed(1)}" font-style="italic" fill="${INK}">+${overflow} more</text>`
    : "";
  return `<rect x="0" y="${top.toFixed(1)}" width="${panelW.toFixed(0)}" height="${panelH.toFixed(1)}" fill="${PANEL_FILL}"/>${rows}${overflowRow}`;
}

function scaleBarMarkup(spec: ScaleBarSpec, width: number, height: number, fontFamily: string): string {
  const x0 = width - PAD - spec.widthPx;
  const y = height - PAD - 6;
  const tick = 5;
  return (
    `<g stroke="${INK}" stroke-width="2">` +
    `<line x1="${x0.toFixed(1)}" y1="${y}" x2="${(x0 + spec.widthPx).toFixed(1)}" y2="${y}"/>` +
    `<line x1="${x0.toFixed(1)}" y1="${y - tick}" x2="${x0.toFixed(1)}" y2="${(y + tick).toFixed(1)}"/>` +
    `<line x1="${(x0 + spec.widthPx).toFixed(1)}" y1="${y - tick}" x2="${(x0 + spec.widthPx).toFixed(1)}" y2="${(y + tick).toFixed(1)}"/>` +
    `</g>` +
    `<text x="${(x0 + spec.widthPx / 2).toFixed(1)}" y="${(y - tick - 4).toFixed(1)}" text-anchor="middle" font-family="${fontFamily}" font-size="${FURNITURE_TEXT_SIZE}" font-weight="600" fill="${INK}">${escapeXml(spec.label)}</text>`
  );
}

function northArrowMarkup(bearing: number, width: number, fontFamily: string): string {
  const cx = width - PAD - 10;
  const cy = PAD + 18;
  return (
    `<g transform="rotate(${(-bearing).toFixed(1)} ${cx} ${cy})">` +
    `<path d="M${cx},${cy - 12} L${cx + 6},${cy + 8} L${cx},${cy + 3.5} L${cx - 6},${cy + 8} Z" fill="${INK}"/>` +
    `<text x="${cx}" y="${cy + 22}" text-anchor="middle" font-family="${fontFamily}" font-size="${FURNITURE_TEXT_SIZE}" font-weight="700" fill="${INK}">N</text>` +
    `</g>`
  );
}

/**
 * Vector rendering of the schematic: ways/services as paths, stations as
 * circles, facilities as colored dots (a simplified stand-in for their on-map
 * pictograms — PNG export is what captures full icon fidelity), plus a title
 * and line-color legend so the output reads as a finished map on its own.
 */
export function systemSvg(
  system: TransitSystem,
  view: ViewOptions,
  project: (lngLat: LngLat) => ScreenPoint,
  opts: SvgRenderOptions,
): string {
  const { width, height } = opts;
  const fontFamily = opts.fontFamily ?? DEFAULT_FONT_FAMILY;
  const fc = buildFeatures(system, null, [], view);

  // One rule, one consequence: text that won't be readable at the size this
  // drawing gets seen isn't drawn. No element is exempt and none is scaled up
  // to save it — growing type to beat the floor just trades an illegible label
  // for one that crowds out the thing it labels.
  //
  // displayWidth defaults to `width`, so a caller that doesn't care gets scale
  // 1: nothing drops, exactly today's behavior.
  const displayScale = (opts.displayWidth ?? width) / width;
  const legible = (authoredPx: number) => authoredPx * displayScale >= MIN_LEGIBLE_PX;

  const borderInset = opts.borderInset ?? 0;
  const parts: string[] = [];

  const pathD = (coords: LngLat[]) =>
    coords
      .map((c, i) => {
        const p = project(c);
        return `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(" ");

  for (const f of fc.ways.features as Feature<LineString>[]) {
    const p = f.properties as { color: string; width: number; dashed?: boolean };
    parts.push(
      `<path d="${pathD(f.geometry.coordinates as LngLat[])}" fill="none" stroke="${p.color}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"${p.dashed ? ' stroke-dasharray="4,4"' : ""} opacity="0.85"/>`,
    );
  }
  for (const f of fc.services.features as Feature<LineString>[]) {
    const p = f.properties as { color: string; width: number; underground?: boolean };
    parts.push(
      `<path d="${pathD(f.geometry.coordinates as LngLat[])}" fill="none" stroke="${p.color}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"${p.underground ? ' stroke-dasharray="5,4"' : ""}/>`,
    );
  }
  // Markers are drawn as they're encountered, but their labels are collected
  // and placed afterwards, together, so collision avoidance can consider all
  // of them at once. Every marker is also registered as an obstacle, so no
  // name ends up sitting on someone else's dot.
  interface LabelCandidate {
    text: string;
    size: number;
    weight: number;
    cx: number;
    cy: number;
    clearance: number;
    /** Placed first, so it wins contested space. An interchange is the label a
     *  reader most needs; a facility name is the one they least need. */
    priority: number;
  }
  const candidates: LabelCandidate[] = [];
  const obstacles: LabelBox[] = [];
  const markerObstacle = (x: number, y: number, r: number) =>
    obstacles.push({ left: x - r, right: x + r, top: y - r, bottom: y + r });

  for (const f of fc.stations.features as Feature<Point>[]) {
    const p = f.properties as { color: string; interchange?: boolean; name?: string };
    const { x, y } = project(f.geometry.coordinates as LngLat);
    const r = p.interchange ? 7 : 5;
    parts.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${PAPER}" stroke="${p.interchange ? INK : p.color}" stroke-width="3"/>`,
    );
    markerObstacle(x, y, r);
    if (p.name && legible(STATION_LABEL_SIZE)) {
      candidates.push({
        text: p.name,
        size: STATION_LABEL_SIZE,
        weight: p.interchange ? 700 : 500,
        cx: x,
        cy: y,
        clearance: r,
        priority: p.interchange ? 2 : 1,
      });
    }
  }
  for (const f of fc.facilities.features as Feature<Point>[]) {
    const p = f.properties as { color: string; radius: number; name?: string };
    const { x, y } = project(f.geometry.coordinates as LngLat);
    parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${p.radius}" fill="${p.color}" stroke="${PAPER}" stroke-width="1.5"/>`);
    markerObstacle(x, y, p.radius);
    if (p.name && legible(FURNITURE_TEXT_SIZE)) {
      candidates.push({ text: p.name, size: FURNITURE_TEXT_SIZE, weight: 400, cx: x, cy: y, clearance: p.radius, priority: 0 });
    }
  }

  // Sorted by priority, ties keeping document order, so the same system always
  // produces the same drawing.
  for (const label of [...candidates].sort((a, b) => b.priority - a.priority)) {
    const placed = placeLabel(label.text, label.size, label.cx, label.cy, label.clearance, obstacles);
    if (!placed) continue; // nowhere clear — absent beats printed through a neighbour
    obstacles.push(placed.box);
    parts.push(
      `<text x="${placed.x.toFixed(1)}" y="${placed.y.toFixed(1)}" text-anchor="${placed.anchor}" font-family="${fontFamily}" font-size="${label.size}" font-weight="${label.weight}" fill="${INK}">${escapeXml(label.text)}</text>`,
    );
  }

  // The title and legend are the caption. Drawn only when nothing else is
  // captioning this image, and only when they'd be readable.
  if (!opts.captionedExternally) {
    if (legible(TITLE_SIZE)) parts.push(titleMarkup(opts.title, width, fontFamily, TITLE_SIZE));
    if (legible(LEGEND_TEXT_SIZE)) parts.push(legendMarkup(opts.legend, width, height, fontFamily, LEGEND_TEXT_SIZE));
  }
  // A north arrow and a scale bar are instruments — unreadable, they're just
  // marks. Both hang on the same legibility test as the text that labels them.
  if (legible(FURNITURE_TEXT_SIZE)) {
    parts.push(northArrowMarkup(opts.bearing ?? 0, width, fontFamily));
    if (opts.scaleBar) parts.push(scaleBarMarkup(opts.scaleBar, width, height, fontFamily));
  }

  const background = opts.background ?? PAPER;
  // The framed panel, painted under everything the map draws. Extends beneath
  // the rule itself (the stroke straddles this edge) so the two never leave a
  // hairline of the outer ground showing between them.
  const insetSurface =
    opts.insetBackground && borderInset > 0
      ? `<rect x="${borderInset}" y="${borderInset}" width="${width - borderInset * 2}" height="${height - borderInset * 2}" fill="${opts.insetBackground}"/>`
      : "";
  // Drawn last, so a line running to the edge passes under the frame rather
  // than over it. Inset by half its width because SVG strokes straddle the
  // path — without that, the outer half falls outside the viewBox and the
  // edge renders at half thickness.
  const borderWidth = opts.borderWidth ?? 1;
  // Inset by half the stroke on top of the requested margin, because SVG
  // strokes straddle their path — without that the outer half of the rule
  // would sit further out than asked, and at zero inset it would fall outside
  // the viewBox and render at half thickness.
  const edge = borderInset + borderWidth / 2;
  const border = opts.borderColor
    ? `<rect x="${edge}" y="${edge}" width="${width - edge * 2}" height="${height - edge * 2}" fill="none" stroke="${opts.borderColor}" stroke-width="${borderWidth}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${background}"/>${insetSurface}${parts.join("")}${border}</svg>`;
}
