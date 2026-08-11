import type { LngLat } from '../model/system';
import { viewportBounds, type Viewport } from './project';

/** Geographic extent visible to a renderer. Map and export adapters convert
 * their native bounds into this core-owned shape at the boundary. */
export interface RenderBounds {
  readonly southwest: LngLat;
  readonly northeast: LngLat;
}

/** Ephemeral camera and display facts used only by presentation projection.
 *
 * `viewport*Px` is the CSS-pixel coordinate space in which the camera was
 * fitted and geometry was projected. `displayed*Px` is the final CSS size at
 * which a person sees that result; it can be smaller than an authored SVG or
 * offscreen export viewport. `pixelRatio` is backing-store pixels per viewport
 * CSS pixel. It controls raster sharpness, never LOD thresholds.
 *
 * This contract deliberately carries no document or physical-geometry cache
 * key. Panning, zooming, resizing, or changing DPR can re-run viewport
 * filtering and presentation without invalidating topology or metric meshes.
 */
export interface RenderPresentation {
  readonly bounds: RenderBounds;
  readonly zoom: number;
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
  readonly displayedWidthPx: number;
  readonly displayedHeightPx: number;
  readonly pixelRatio: number;
}

export interface ViewportRenderPresentationOptions {
  readonly displayedWidthPx?: number;
  readonly displayedHeightPx?: number;
  readonly pixelRatio?: number;
}

/** Builds deterministic static-render presentation facts from the final
 * fitted viewport. Vector output defaults to DPR 1 because backing-pixel
 * density is not meaningful to its screen-space detail decision. */
export function renderPresentationForViewport(
  viewport: Viewport,
  options: ViewportRenderPresentationOptions = {},
): RenderPresentation {
  const [southwest, northeast] = viewportBounds(viewport);
  return {
    bounds: { southwest, northeast },
    zoom: viewport.zoom,
    viewportWidthPx: viewport.width,
    viewportHeightPx: viewport.height,
    displayedWidthPx: options.displayedWidthPx ?? viewport.width,
    displayedHeightPx: options.displayedHeightPx ?? viewport.height,
    pixelRatio: options.pixelRatio ?? 1,
  };
}

export type RenderTier = 'overview' | 'district' | 'street';

export interface ProjectedViewportVector {
  readonly xPx: number;
  readonly yPx: number;
}

export interface RenderTierWeights {
  readonly overview: number;
  readonly district: number;
  readonly street: number;
}

export interface RenderTierBlend {
  readonly weights: RenderTierWeights;
  /** Canonical low-to-high-detail order, excluding every zero-weight tier. */
  readonly activeTiers: readonly RenderTier[];
}

export interface RenderTierResolution {
  readonly logicalTier: RenderTier;
  /** Deterministic paint weights; never depends on resolver history. */
  readonly blend: RenderTierBlend;
  /** Geometry retained for the deterministic overlap plus the logical tier at
   * the exact hysteresis boundary. */
  readonly retainedTiers: readonly RenderTier[];
  /** True only when an already-known corridor changes logical tier. */
  readonly transitioned: boolean;
}

export interface RenderTierStateResolver {
  resolve(
    documentId: string,
    corridorId: string,
    displayedCorridorWidthPx: number,
  ): RenderTierResolution;
  /** Clear corridor history. Passing the next document id also establishes it
   * without making the first resolution look like a transition. */
  reset(documentId?: string): void;
}

export const RENDER_TIER_THRESHOLDS = {
  district: {
    enterPx: 3,
    leavePx: 2,
    fadeStartPx: 2,
    fadeEndPx: 4,
  },
  street: {
    enterPx: 12,
    leavePx: 9,
    fadeStartPx: 9,
    fadeEndPx: 12,
  },
} as const;

const OVERVIEW_ACTIVE = ['overview'] as const;
const OVERVIEW_DISTRICT_ACTIVE = ['overview', 'district'] as const;
const DISTRICT_ACTIVE = ['district'] as const;
const DISTRICT_STREET_ACTIVE = ['district', 'street'] as const;
const STREET_ACTIVE = ['street'] as const;

// Most corridors sit outside a transition band. Reusing these settled values
// keeps the per-corridor selector allocation-free in that common case while
// the two continuously interpolated bands still carry their exact weights.
const OVERVIEW_BLEND: RenderTierBlend = {
  weights: { overview: 1, district: 0, street: 0 },
  activeTiers: OVERVIEW_ACTIVE,
};
const DISTRICT_BLEND: RenderTierBlend = {
  weights: { overview: 0, district: 1, street: 0 },
  activeTiers: DISTRICT_ACTIVE,
};
const STREET_BLEND: RenderTierBlend = {
  weights: { overview: 0, district: 0, street: 1 },
  activeTiers: STREET_ACTIVE,
};

const TIER_BOUNDARY_WIDTHS = [2, 3, 4, 9, 12] as const;

function normalizedProjectedWidth(displayedCorridorWidthPx: number): number {
  if (!Number.isFinite(displayedCorridorWidthPx) || displayedCorridorWidthPx < 0) {
    throw new RangeError(
      'Projected corridor width must be a finite, non-negative CSS-pixel value.',
    );
  }
  const boundary = TIER_BOUNDARY_WIDTHS.find(
    (width) => Math.abs(displayedCorridorWidthPx - width) <= 1e-9,
  );
  return boundary ?? displayedCorridorWidthPx;
}

/** Converts a vector from the camera's projection space into the CSS-pixel
 * space in which the result will actually be seen. Pixel ratio is
 * intentionally absent from the calculation: more backing pixels sharpen an
 * image but do not make a corridor appear larger. */
export function displayedProjectedLengthPx(
  vector: ProjectedViewportVector,
  presentation: RenderPresentation,
): number {
  const displayedX = vector.xPx * (presentation.displayedWidthPx / presentation.viewportWidthPx);
  const displayedY = vector.yPx * (presentation.displayedHeightPx / presentation.viewportHeightPx);
  return Math.hypot(displayedX, displayedY);
}

/** Selects retained logical detail for live rendering. With no previous tier,
 * the result is a deterministic static/export decision. Paint weights remain
 * a separate fact (see `renderTierBlend`) so hysteresis cannot cause popping
 * or make a static artifact depend on render history. */
export function selectRenderTier(
  displayedCorridorWidthPx: number,
  previousTier?: RenderTier,
): RenderTier {
  const widthPx = normalizedProjectedWidth(displayedCorridorWidthPx);

  if (widthPx >= RENDER_TIER_THRESHOLDS.street.enterPx) return 'street';
  if (widthPx < RENDER_TIER_THRESHOLDS.district.leavePx) return 'overview';

  if (previousTier === 'street') {
    return widthPx >= RENDER_TIER_THRESHOLDS.street.leavePx ? 'street' : 'district';
  }
  if (previousTier === 'district') return 'district';
  return widthPx >= RENDER_TIER_THRESHOLDS.district.enterPx ? 'district' : 'overview';
}

/** Deterministic cross-fade weights for live and static renderers alike. Heavy
 * tiers appear in `activeTiers` only while they have visible weight, allowing
 * callers to avoid generating or uploading zero-opacity meshes. */
export function renderTierBlend(displayedCorridorWidthPx: number): RenderTierBlend {
  const widthPx = normalizedProjectedWidth(displayedCorridorWidthPx);

  if (widthPx <= RENDER_TIER_THRESHOLDS.district.fadeStartPx) {
    return OVERVIEW_BLEND;
  }
  if (widthPx < RENDER_TIER_THRESHOLDS.district.fadeEndPx) {
    const district =
      (widthPx - RENDER_TIER_THRESHOLDS.district.fadeStartPx) /
      (RENDER_TIER_THRESHOLDS.district.fadeEndPx - RENDER_TIER_THRESHOLDS.district.fadeStartPx);
    return {
      weights: { overview: 1 - district, district, street: 0 },
      activeTiers: OVERVIEW_DISTRICT_ACTIVE,
    };
  }
  if (widthPx <= RENDER_TIER_THRESHOLDS.street.fadeStartPx) {
    return DISTRICT_BLEND;
  }
  if (widthPx < RENDER_TIER_THRESHOLDS.street.fadeEndPx) {
    const street =
      (widthPx - RENDER_TIER_THRESHOLDS.street.fadeStartPx) /
      (RENDER_TIER_THRESHOLDS.street.fadeEndPx - RENDER_TIER_THRESHOLDS.street.fadeStartPx);
    return {
      weights: { overview: 0, district: 1 - street, street },
      activeTiers: DISTRICT_STREET_ACTIVE,
    };
  }
  return STREET_BLEND;
}

function retainedRenderTiers(blend: RenderTierBlend): readonly RenderTier[] {
  // Hysteresis retains the logical state used by the next camera sample, not
  // zero-opacity GPU geometry. The deterministic overlap already contains
  // every tier that can contribute a pixel at this exact presentation.
  return blend.activeTiers;
}

class PerCorridorRenderTierState implements RenderTierStateResolver {
  private documentId: string | undefined;
  private readonly tiers = new Map<string, RenderTier>();

  resolve(
    documentId: string,
    corridorId: string,
    displayedCorridorWidthPx: number,
  ): RenderTierResolution {
    if (this.documentId !== documentId) this.reset(documentId);
    const previousTier = this.tiers.get(corridorId);
    const logicalTier = selectRenderTier(displayedCorridorWidthPx, previousTier);
    const blend = renderTierBlend(displayedCorridorWidthPx);
    this.tiers.set(corridorId, logicalTier);
    return {
      logicalTier,
      blend,
      retainedTiers: retainedRenderTiers(blend),
      transitioned: previousTier !== undefined && previousTier !== logicalTier,
    };
  }

  reset(documentId?: string): void {
    this.documentId = documentId;
    this.tiers.clear();
  }
}

export function createRenderTierStateResolver(): RenderTierStateResolver {
  return new PerCorridorRenderTierState();
}
