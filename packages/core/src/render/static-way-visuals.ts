import type { SystemFeatures } from './buildFeatures';
import type { ResolvedStaticVisual } from './static-visual-scene';
import {
  boolean,
  lngLatPath,
  numeric,
  resolvedPaintOpacity,
  scaledMetricWidth,
  text,
  tier,
  tierOpacity,
} from './static-visual-paint';

export interface AppendStaticWayVisualsInput {
  features: SystemFeatures['ways']['features'];
  visuals: ResolvedStaticVisual[];
  zoom: number;
  routeCasingColor: string;
  dashed: boolean;
  casing: boolean;
}

function appendDistrictFootprint(
  feature: SystemFeatures['ways']['features'][number],
  input: AppendStaticWayVisualsInput,
): void {
  const { visuals, routeCasingColor, casing, dashed: passDashed } = input;
  if (feature.geometry.type !== 'Polygon') return;
  if (casing || passDashed || boolean(feature.properties, 'dashed')) return;

  const opacity = resolvedPaintOpacity(feature.properties, 0.9);
  if (opacity <= 0) return;
  visuals.push({
    kind: 'polygon',
    featureId: String(feature.id),
    source: 'ways',
    rings: feature.geometry.coordinates.map(lngLatPath),
    color: text(feature.properties, 'color', routeCasingColor),
    outlineColor: routeCasingColor,
    renderTier: tier(feature.properties),
    tierOpacity: tierOpacity(feature.properties),
    opacity,
  });
}

function appendWayLine(
  feature: SystemFeatures['ways']['features'][number],
  input: AppendStaticWayVisualsInput,
): void {
  const { visuals, zoom, routeCasingColor, dashed: passDashed, casing } = input;
  if (feature.geometry.type !== 'LineString') return;
  const dashed = boolean(feature.properties, 'dashed');
  if (dashed !== passDashed) return;

  const width =
    tier(feature.properties) === 'district'
      ? scaledMetricWidth(numeric(feature.properties, 'corridorW14', 1), zoom)
      : numeric(feature.properties, 'width', 3);
  const opacity = resolvedPaintOpacity(feature.properties, casing ? 0.62 : 0.9);
  if (opacity <= 0) return;
  visuals.push({
    kind: 'line',
    featureId: String(feature.id),
    source: 'ways',
    coordinates: lngLatPath(feature.geometry.coordinates),
    color: casing ? routeCasingColor : text(feature.properties, 'color', routeCasingColor),
    widthPx: casing ? width + 2 : width,
    offsetPx: 0,
    lineCap: 'round',
    lineJoin: 'round',
    ...(dashed ? { dashArray: [2, 2] } : {}),
    renderTier: tier(feature.properties),
    tierOpacity: tierOpacity(feature.properties),
    opacity,
  });
}

/** Resolve the Overview line and District footprint paint passes. The scene
 * assembler provides shared opacity/property rules; this module owns only the
 * Way geometry distinction so SVG cannot accidentally inflate a District line. */
export function appendStaticWayVisuals(input: AppendStaticWayVisualsInput): void {
  for (const feature of input.features) {
    if (boolean(feature.properties, 'haloOnly')) continue;
    if (feature.geometry.type === 'Polygon') {
      appendDistrictFootprint(feature, input);
      continue;
    }
    appendWayLine(feature, input);
  }
}
