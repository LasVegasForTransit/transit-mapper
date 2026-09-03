import { defaultProfileFor, profileWidthM } from '@transitmapper/core/model/profile';
import type { DetailBand } from '@transitmapper/core/network/query';
import { widthPxAtZ14 } from '@transitmapper/core/render/constants';
import {
  renderTierBlend,
  selectRenderTier,
  type RenderPresentation,
  type RenderTier,
  type RenderTierBlend,
} from '@transitmapper/core/render/render-presentation';

/** Structural subset of MapLibre's LngLat used at the web/core boundary. */
interface MapLngLatLike {
  readonly lng: number;
  readonly lat: number;
}

/** Structural subset of MapLibre's LngLatBounds. Keeping the adapter
 * structural makes the contract testable without constructing a WebGL map. */
export interface MapBoundsLike {
  getSouthWest(): MapLngLatLike;
  getNorthEast(): MapLngLatLike;
}

export interface MapRenderPresentationInput {
  readonly bounds: MapBoundsLike;
  readonly zoom: number;
  /** CSS-pixel dimensions used by MapLibre's camera and `project()`. */
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
  /** Final CSS-pixel footprint after any export/embed downscaling. */
  readonly displayedWidthPx: number;
  readonly displayedHeightPx: number;
  /** Backing-store pixels per viewport CSS pixel; never an LOD multiplier. */
  readonly pixelRatio: number;
}

export interface CorridorTierInput {
  /** Stable semantic corridor identity, not an output index or geometry hash. */
  readonly corridorId: string;
  readonly widthM: number;
  readonly latitude: number;
  readonly presentation: RenderPresentation;
}

export interface CorridorTierResult {
  readonly displayedWidthPx: number;
  readonly tier: RenderTier;
  readonly blend: RenderTierBlend;
}

/** Copies the current MapLibre camera/display facts into the DOM-free core
 * presentation shape. No map object or mutable bound object crosses the
 * boundary. */
export function renderPresentationFromMap(input: MapRenderPresentationInput): RenderPresentation {
  const southwest = input.bounds.getSouthWest();
  const northeast = input.bounds.getNorthEast();
  return {
    bounds: {
      southwest: [southwest.lng, southwest.lat],
      northeast: [northeast.lng, northeast.lat],
    },
    zoom: input.zoom,
    viewportWidthPx: input.viewportWidthPx,
    viewportHeightPx: input.viewportHeightPx,
    displayedWidthPx: input.displayedWidthPx,
    displayedHeightPx: input.displayedHeightPx,
    pixelRatio: input.pixelRatio,
  };
}

/** Projects the existing z14 metric width convention into the size a person
 * actually sees. Map and export canvases preserve aspect ratio; taking the
 * limiting axis also gives contained/letterboxed output a conservative,
 * orientation-independent LOD size. DPR deliberately does not participate. */
export function displayedCorridorWidthPx(
  widthM: number,
  latitude: number,
  presentation: RenderPresentation,
): number {
  const viewportWidthPx = widthPxAtZ14(widthM, latitude) * 2 ** (presentation.zoom - 14);
  const displayScale = Math.min(
    presentation.displayedWidthPx / presentation.viewportWidthPx,
    presentation.displayedHeightPx / presentation.viewportHeightPx,
  );
  return viewportWidthPx * displayScale;
}

/** The detail a network query asks content for, measured the same way the
 * renderer measures paint detail: a default road cross-section at the centre
 * of the visible bounds. Deriving it keeps the resolved content and the
 * painted tier from disagreeing about what this camera can show.
 *
 * No previous tier is passed. Hysteresis would let one camera resolve two
 * different bands depending on how a person arrived at it, and a query that
 * depends on render history cannot be cached, replayed, or compared. */
export function queryDetailBand(presentation: RenderPresentation): DetailBand {
  const { southwest, northeast } = presentation.bounds;
  const widthPx = displayedCorridorWidthPx(
    profileWidthM(defaultProfileFor('road')),
    (southwest[1] + northeast[1]) / 2,
    presentation,
  );
  return selectRenderTier(widthPx);
}

/** Live-only hysteresis keyed by stable corridor identity. Static renderers do
 * not need this registry: omitting prior state from the core selector is their
 * deterministic contract. Reset an identity when it disappears, or reset the
 * registry on document/source replacement so history cannot leak systems. */
export class CorridorTierRegistry {
  private readonly previousTierByCorridor = new Map<string, RenderTier>();

  resolve(input: CorridorTierInput): CorridorTierResult {
    const displayedWidthPx = displayedCorridorWidthPx(
      input.widthM,
      input.latitude,
      input.presentation,
    );
    const tier = selectRenderTier(
      displayedWidthPx,
      this.previousTierByCorridor.get(input.corridorId),
    );
    this.previousTierByCorridor.set(input.corridorId, tier);
    return {
      displayedWidthPx,
      tier,
      blend: renderTierBlend(displayedWidthPx),
    };
  }

  reset(corridorId?: string): void {
    if (corridorId === undefined) {
      this.previousTierByCorridor.clear();
      return;
    }
    this.previousTierByCorridor.delete(corridorId);
  }
}
