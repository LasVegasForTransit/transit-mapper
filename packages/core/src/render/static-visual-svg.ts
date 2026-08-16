import type { LngLat } from '../model/system';
import type { ScreenPoint } from './project';
import type {
  ResolvedStaticCircle,
  ResolvedStaticLine,
  ResolvedStaticPolygon,
  ResolvedStaticVisual,
} from './static-visual-scene';

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function offsetScreenPath(points: ScreenPoint[], offsetPx: number): ScreenPoint[] {
  if (offsetPx === 0 || points.length < 2) return points;
  const normals = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    const length = Math.hypot(dx, dy);
    return length > 0 ? { x: -dy / length, y: dx / length } : { x: 0, y: 0 };
  });
  return points.map((point, index) => {
    const previous = normals[Math.max(0, index - 1)] ?? { x: 0, y: 0 };
    const next = normals[Math.min(normals.length - 1, index)] ?? previous;
    const mx = previous.x + next.x;
    const my = previous.y + next.y;
    const miterLength = Math.hypot(mx, my);
    if (miterLength === 0) {
      return { x: point.x + next.x * offsetPx, y: point.y + next.y * offsetPx };
    }
    const ux = mx / miterLength;
    const uy = my / miterLength;
    const alignment = Math.max(0.25, ux * next.x + uy * next.y);
    const distance = offsetPx / alignment;
    return { x: point.x + ux * distance, y: point.y + uy * distance };
  });
}

function metadata(visual: ResolvedStaticVisual): string {
  const renderTier = visual.renderTier ? ` data-render-tier="${visual.renderTier}"` : '';
  return (
    ` data-render-source="${visual.source}"` +
    ` data-feature-id="${escapeAttribute(visual.featureId)}"` +
    renderTier +
    ` data-tier-opacity="${visual.tierOpacity.toFixed(4)}"`
  );
}

function lineMarkup(visual: ResolvedStaticLine, project: (lngLat: LngLat) => ScreenPoint): string {
  const points = offsetScreenPath(visual.coordinates.map(project), visual.offsetPx);
  const d = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(' ');
  const dash = visual.dashArray ? ` stroke-dasharray="${visual.dashArray.join(',')}"` : '';
  return (
    `<path${metadata(visual)} data-resolved-width="${visual.widthPx.toFixed(3)}"` +
    ` d="${d}" fill="none" stroke="${visual.color}" stroke-width="${visual.widthPx.toFixed(3)}"` +
    ` stroke-linecap="${visual.lineCap}" stroke-linejoin="${visual.lineJoin}"${dash}` +
    ` opacity="${visual.opacity.toFixed(4)}"/>`
  );
}

function polygonMarkup(
  visual: ResolvedStaticPolygon,
  project: (lngLat: LngLat) => ScreenPoint,
): string {
  const d = visual.rings
    .map(
      (ring) =>
        ring
          .map((coordinate, index) => {
            const point = project(coordinate);
            return `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
          })
          .join(' ') + ' Z',
    )
    .join(' ');
  const outline = visual.outlineColor ? ` stroke="${visual.outlineColor}" stroke-width="1"` : '';
  return `<path${metadata(visual)} d="${d}" fill="${visual.color}"${outline} opacity="${visual.opacity.toFixed(4)}"/>`;
}

function circleMarkup(
  visual: ResolvedStaticCircle,
  project: (lngLat: LngLat) => ScreenPoint,
): string {
  const point = project(visual.coordinate);
  return (
    `<circle${metadata(visual)} cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}"` +
    ` r="${visual.radiusPx.toFixed(3)}" fill="${visual.color}"` +
    ` stroke="${visual.outlineColor}" stroke-width="1" opacity="${visual.opacity.toFixed(4)}"/>`
  );
}

export function staticVisualSvgMarkup(
  visual: ResolvedStaticVisual,
  project: (lngLat: LngLat) => ScreenPoint,
): string {
  if (visual.kind === 'line') return lineMarkup(visual, project);
  if (visual.kind === 'circle') return circleMarkup(visual, project);
  return polygonMarkup(visual, project);
}
