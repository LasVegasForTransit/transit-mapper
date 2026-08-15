export type FloatingAlign = 'center' | 'end' | 'start';
export type FloatingSide = 'bottom' | 'left' | 'right' | 'top';

interface AnchorEdges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface SurfaceSize {
  width: number;
  height: number;
}

interface ViewportBounds extends SurfaceSize {
  padding: number;
}

interface FloatingPreference {
  side: FloatingSide;
  align: FloatingAlign;
  gap: number;
}

interface FloatingPositionInput {
  anchor: AnchorEdges;
  surface: SurfaceSize;
  viewport: ViewportBounds;
  preference: FloatingPreference;
}

export interface FloatingPosition {
  left: number;
  top: number;
  side: FloatingSide;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function opposite(side: FloatingSide): FloatingSide {
  if (side === 'bottom') return 'top';
  if (side === 'top') return 'bottom';
  if (side === 'left') return 'right';
  return 'left';
}

function mainAxisFits(input: FloatingPositionInput, side: FloatingSide): boolean {
  const { anchor, surface, viewport, preference } = input;
  if (side === 'bottom') {
    return anchor.bottom + preference.gap + surface.height <= viewport.height - viewport.padding;
  }
  if (side === 'top') {
    return anchor.top - preference.gap - surface.height >= viewport.padding;
  }
  if (side === 'right') {
    return anchor.right + preference.gap + surface.width <= viewport.width - viewport.padding;
  }
  return anchor.left - preference.gap - surface.width >= viewport.padding;
}

function resolvedSide(input: FloatingPositionInput): FloatingSide {
  if (mainAxisFits(input, input.preference.side)) return input.preference.side;
  const flipped = opposite(input.preference.side);
  return mainAxisFits(input, flipped) ? flipped : input.preference.side;
}

function alignedStart(
  start: number,
  end: number,
  surfaceSize: number,
  align: FloatingAlign,
): number {
  if (align === 'start') return start;
  if (align === 'end') return end - surfaceSize;
  return (start + end - surfaceSize) / 2;
}

/** Collision-aware fallback for engines that do not yet expose CSS anchors. */
export function positionFloatingSurface(input: FloatingPositionInput): FloatingPosition {
  const { anchor, surface, viewport, preference } = input;
  const side = resolvedSide(input);
  const vertical = side === 'bottom' || side === 'top';
  const preferredLeft = vertical
    ? alignedStart(anchor.left, anchor.right, surface.width, preference.align)
    : side === 'right'
      ? anchor.right + preference.gap
      : anchor.left - preference.gap - surface.width;
  const preferredTop = vertical
    ? side === 'bottom'
      ? anchor.bottom + preference.gap
      : anchor.top - preference.gap - surface.height
    : alignedStart(anchor.top, anchor.bottom, surface.height, preference.align);
  return {
    left: clamp(preferredLeft, viewport.padding, viewport.width - viewport.padding - surface.width),
    top: clamp(preferredTop, viewport.padding, viewport.height - viewport.padding - surface.height),
    side,
  };
}
