import type { GeoJsonProperties, Position } from 'geojson';
import type { LngLat } from '../model/system';
import type { SystemFeatures } from './buildFeatures';
import type { RenderPresentation } from './render-presentation';
import { systemFeatureSourceId } from './render-identity';
import type { RenderScene } from './render-scene';
import {
  STATIC_SERVICE_PAINT_PASSES,
  staticServiceIncludedInPass,
  staticServicePassPaint,
} from './static-visual-service-paint';
import {
  createOrderedSystemRenderVisuals,
  type SystemFeatureSourceMap,
} from './system-render-scene';

export type StaticVisualSource =
  'junctions' | 'lanes' | 'lane-markings' | 'connectors' | 'ways' | 'services';

export type StaticVisualTier = 'overview' | 'district' | 'street';

interface ResolvedStaticVisualBase {
  featureId: string;
  source: StaticVisualSource;
  renderTier?: StaticVisualTier;
  tierOpacity: number;
  opacity: number;
}

export interface ResolvedStaticLine extends ResolvedStaticVisualBase {
  kind: 'line';
  coordinates: LngLat[];
  color: string;
  widthPx: number;
  offsetPx: number;
  dashArray?: readonly number[];
  lineCap: 'butt' | 'round';
  lineJoin: 'round';
}

export interface ResolvedStaticPolygon extends ResolvedStaticVisualBase {
  kind: 'polygon';
  rings: LngLat[][];
  color: string;
}

export type ResolvedStaticVisual = ResolvedStaticLine | ResolvedStaticPolygon;

export interface ResolvedStaticVisualScene {
  scene: RenderScene;
  features: SystemFeatures;
  /** Exact settled paint order. Every value needed by a non-MapLibre vector
   * surface is resolved here; serializers never interpret style expressions. */
  visuals: readonly ResolvedStaticVisual[];
}

export interface ResolveStaticVisualSceneInput {
  revision: string;
  features: SystemFeatures;
  presentation: RenderPresentation;
  /** Surface-owned casing ink. Editor/export SVG defaults to the geographic
   * renderer palette; public brand cards pass the LVBT on-surface token. */
  routeCasingColor?: string;
}

const STATIC_SOURCE_IDS: SystemFeatureSourceMap = {
  ways: systemFeatureSourceId('ways'),
  services: systemFeatureSourceId('services'),
  stations: systemFeatureSourceId('stations'),
  handles: systemFeatureSourceId('handles'),
  serviceTermini: systemFeatureSourceId('service-termini'),
  footprints: systemFeatureSourceId('footprints'),
  platforms: systemFeatureSourceId('platforms'),
  facilities: systemFeatureSourceId('facilities'),
  physicalHandles: systemFeatureSourceId('physical-handles'),
  lanes: systemFeatureSourceId('lanes'),
  laneMarkings: systemFeatureSourceId('lane-markings'),
  laneArrows: systemFeatureSourceId('lane-arrows'),
  serviceArrows: systemFeatureSourceId('service-arrows'),
  junctions: systemFeatureSourceId('junctions'),
  connectors: systemFeatureSourceId('connectors'),
  wayLabels: systemFeatureSourceId('way-labels'),
};

// The SVG export is presently a light cartographic surface. These values are
// the same resolved light-theme paints as the geographic MapLibre renderer.
const ROUTE_CASING = '#191a17';
const ROAD_SURFACE = '#7d8188';
const LANE_MARKING = '#f4f2ec';
const CENTER_LINE = '#d9a62e';

function numeric(properties: GeoJsonProperties, key: string, fallback: number): number {
  const value: unknown = properties ? (properties as Record<string, unknown>)[key] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boolean(properties: GeoJsonProperties, key: string): boolean {
  return properties ? (properties as Record<string, unknown>)[key] === true : false;
}

function text(properties: GeoJsonProperties, key: string, fallback: string): string {
  const value: unknown = properties ? (properties as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' ? value : fallback;
}

function tier(properties: GeoJsonProperties): StaticVisualTier | undefined {
  const value: unknown = properties
    ? (properties as Record<string, unknown>).renderTier
    : undefined;
  return value === 'overview' || value === 'district' || value === 'street' ? value : undefined;
}

function tierOpacity(properties: GeoJsonProperties): number {
  return Math.max(0, Math.min(1, numeric(properties, 'tierOpacity', 1)));
}

function hasProperty(properties: GeoJsonProperties, key: string): boolean {
  return properties !== null && Object.hasOwn(properties, key);
}

function lowerTierOpacity(baseOpacity: number, upperWeight: number): number {
  if (upperWeight <= 0) return baseOpacity;
  if (upperWeight >= 1) return 0;
  return (baseOpacity * (1 - upperWeight)) / (1 - baseOpacity * upperWeight);
}

function interpolatedWeight(value: number, lower: number, upper: number): number {
  return Math.max(0, Math.min(1, (value - lower) / (upper - lower)));
}

function hasTierAvailabilityContract(properties: GeoJsonProperties): boolean {
  return ['projectedWidthPx', 'hasOverviewTier', 'hasDistrictTier', 'hasStreetTier'].every((key) =>
    hasProperty(properties, key),
  );
}

function resolvedPaintOpacity(properties: GeoJsonProperties, baseOpacity: number): number {
  const resolvedTier = tier(properties);
  if (!resolvedTier || !hasProperty(properties, 'corridorW14')) {
    return baseOpacity * tierOpacity(properties);
  }
  const projectedWidth = numeric(properties, 'projectedWidthPx', 0);
  if (!hasTierAvailabilityContract(properties)) return baseOpacity * tierOpacity(properties);
  const hasOverview = boolean(properties, 'hasOverviewTier');
  const hasDistrict = boolean(properties, 'hasDistrictTier');
  const hasStreet = boolean(properties, 'hasStreetTier');

  if (resolvedTier === 'overview') {
    if (!hasDistrict) return baseOpacity;
    return lowerTierOpacity(baseOpacity, interpolatedWeight(projectedWidth, 2, 4));
  }
  if (resolvedTier === 'street') {
    if (!hasDistrict) return baseOpacity;
    return baseOpacity * interpolatedWeight(projectedWidth, 9, 12);
  }
  if (!hasOverview && projectedWidth < 4) return baseOpacity;
  if (!hasStreet && projectedWidth > 9) return baseOpacity;
  if (projectedWidth < 4) {
    return baseOpacity * interpolatedWeight(projectedWidth, 2, 4);
  }
  if (projectedWidth > 9) {
    return lowerTierOpacity(baseOpacity, interpolatedWeight(projectedWidth, 9, 12));
  }
  return baseOpacity;
}

function scaledMetricWidth(w14: number, zoom: number): number {
  return w14 * 2 ** (zoom - 14);
}

function serviceWidth(properties: GeoJsonProperties, zoom: number): number {
  const w14: unknown = properties ? (properties as Record<string, unknown>).w14 : undefined;
  if (typeof w14 !== 'number') return numeric(properties, 'width', 3);
  if (zoom <= 15) return 2.5;
  if (zoom >= 21) return 15;
  if (zoom <= 18) return 2.5 + ((zoom - 15) / 3) * 4.5;
  return 7 + ((zoom - 18) / 3) * 8;
}

interface LineInput {
  featureId: string;
  source: StaticVisualSource;
  coordinates: LngLat[];
  properties: GeoJsonProperties;
  color: string;
  widthPx: number;
  baseOpacity: number;
  marginPx?: number;
  dashArray?: readonly number[];
  lineCap?: 'butt' | 'round';
}

function line(input: LineInput): ResolvedStaticLine | null {
  const resolvedTierOpacity = tierOpacity(input.properties);
  const opacity = resolvedPaintOpacity(input.properties, input.baseOpacity);
  if (opacity <= 0) return null;
  return {
    kind: 'line',
    featureId: input.featureId,
    source: input.source,
    coordinates: input.coordinates,
    color: input.color,
    widthPx: input.widthPx + (input.marginPx ?? 0),
    offsetPx: numeric(input.properties, 'offset', 0),
    ...(input.dashArray ? { dashArray: input.dashArray } : {}),
    lineCap: input.lineCap ?? 'round',
    lineJoin: 'round',
    renderTier: tier(input.properties),
    tierOpacity: resolvedTierOpacity,
    opacity,
  };
}

function pushLine(visuals: ResolvedStaticVisual[], value: ResolvedStaticLine | null): void {
  if (value) visuals.push(value);
}

function lngLatPath(coordinates: Position[]): LngLat[] {
  return coordinates.map((coordinate) => {
    if (coordinate.length < 2) {
      throw new Error('Static visual geometry requires two-dimensional coordinates.');
    }
    const [lng, lat] = coordinate;
    return [lng, lat];
  });
}

function appendJunctionVisuals(features: SystemFeatures, visuals: ResolvedStaticVisual[]): void {
  for (const feature of features.junctions.features) {
    const resolvedTierOpacity = tierOpacity(feature.properties);
    const opacity = resolvedPaintOpacity(feature.properties, 0.9);
    if (opacity <= 0) continue;
    visuals.push({
      kind: 'polygon',
      featureId: String(feature.id),
      source: 'junctions',
      rings: feature.geometry.coordinates.map(lngLatPath),
      color: ROAD_SURFACE,
      renderTier: tier(feature.properties),
      tierOpacity: resolvedTierOpacity,
      opacity,
    });
  }
}

function appendLaneVisuals(features: SystemFeatures, visuals: ResolvedStaticVisual[]): void {
  for (const feature of features.lanes.features) {
    const opacity = resolvedPaintOpacity(feature.properties, 0.9);
    if (opacity <= 0) continue;
    visuals.push({
      kind: 'polygon',
      featureId: String(feature.id),
      source: 'lanes',
      rings: feature.geometry.coordinates.map(lngLatPath),
      color: text(feature.properties, 'color', ROAD_SURFACE),
      renderTier: tier(feature.properties),
      tierOpacity: tierOpacity(feature.properties),
      opacity,
    });
  }
}

function markingPaint(properties: GeoJsonProperties): {
  color: string;
  width: number;
  opacity: number;
  dashArray?: readonly number[];
} {
  const kind = text(properties, 'kind', 'laneLine');
  if (kind === 'rail')
    return { color: text(properties, 'color', ROAD_SURFACE), width: 1.3, opacity: 1 };
  if (kind === 'railTie')
    return { color: text(properties, 'color', ROAD_SURFACE), width: 0.7, opacity: 0.78 };
  if (kind === 'thinLane') {
    return { color: text(properties, 'color', LANE_MARKING), width: 2.5, opacity: 1 };
  }
  if (kind === 'centerLine') return { color: CENTER_LINE, width: 1.8, opacity: 0.95 };
  if (kind === 'edgeLine') return { color: LANE_MARKING, width: 1.2, opacity: 0.75 };
  return { color: LANE_MARKING, width: 1.2, opacity: 0.9, dashArray: [3, 3] };
}

function appendLaneMarkingPaths(
  visuals: ResolvedStaticVisual[],
  feature: SystemFeatures['laneMarkings']['features'][number],
  marking: ReturnType<typeof markingPaint>,
): void {
  const paths =
    feature.geometry.type === 'LineString'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  for (const coordinates of paths) {
    pushLine(
      visuals,
      line({
        featureId: String(feature.id),
        source: 'lane-markings',
        coordinates: lngLatPath(coordinates),
        properties: feature.properties,
        color: marking.color,
        widthPx: marking.width,
        baseOpacity: marking.opacity,
        ...(marking.dashArray ? { dashArray: marking.dashArray } : {}),
      }),
    );
  }
}

function appendLaneMarkingVisuals(features: SystemFeatures, visuals: ResolvedStaticVisual[]): void {
  for (const kind of ['railTie', 'rail', 'thinLane', 'laneLine', 'edgeLine', 'centerLine']) {
    for (const feature of features.laneMarkings.features) {
      if (text(feature.properties, 'kind', 'laneLine') !== kind) continue;
      const marking = markingPaint(feature.properties);
      appendLaneMarkingPaths(visuals, feature, marking);
    }
  }
}

function appendConnectorVisuals(features: SystemFeatures, visuals: ResolvedStaticVisual[]): void {
  for (const feature of features.connectors.features) {
    pushLine(
      visuals,
      line({
        featureId: String(feature.id),
        source: 'connectors',
        coordinates: lngLatPath(feature.geometry.coordinates),
        properties: feature.properties,
        color: LANE_MARKING,
        widthPx: 1.2,
        baseOpacity: 0.55,
        dashArray: [1.5, 2],
      }),
    );
  }
}

function resolvedWayWidth(properties: GeoJsonProperties, zoom: number): number {
  return tier(properties) === 'district'
    ? scaledMetricWidth(numeric(properties, 'corridorW14', 1), zoom)
    : numeric(properties, 'width', 3);
}

interface WayPaintPass {
  dashed: boolean;
  casing: boolean;
  routeCasingColor: string;
}

function appendWayPass(
  features: SystemFeatures['ways']['features'],
  visuals: ResolvedStaticVisual[],
  zoom: number,
  pass: WayPaintPass,
): void {
  for (const feature of features) {
    const dashed = boolean(feature.properties, 'dashed');
    if (dashed !== pass.dashed) continue;
    pushLine(
      visuals,
      line({
        featureId: String(feature.id),
        source: 'ways',
        coordinates: lngLatPath(feature.geometry.coordinates),
        properties: feature.properties,
        color: pass.casing
          ? pass.routeCasingColor
          : text(feature.properties, 'color', pass.routeCasingColor),
        widthPx: resolvedWayWidth(feature.properties, zoom),
        ...(pass.casing ? { marginPx: 2 } : {}),
        baseOpacity: pass.casing ? 0.62 : 0.9,
        ...(dashed ? { dashArray: [2, 2] } : {}),
      }),
    );
  }
}

function appendWayVisuals(
  features: SystemFeatures,
  visuals: ResolvedStaticVisual[],
  zoom: number,
  routeCasingColor: string,
): void {
  const visibleWays = features.ways.features.filter(
    (feature) => !boolean(feature.properties, 'haloOnly'),
  );
  const passes = [
    { dashed: false, casing: true },
    { dashed: false, casing: false },
    { dashed: true, casing: true },
    { dashed: true, casing: false },
  ];
  for (const pass of passes) {
    appendWayPass(visibleWays, visuals, zoom, { ...pass, routeCasingColor });
  }
}

function appendServiceVisuals(
  features: SystemFeatures,
  visuals: ResolvedStaticVisual[],
  zoom: number,
  routeCasingColor: string,
): void {
  for (const pass of STATIC_SERVICE_PAINT_PASSES) {
    for (const feature of features.services.features) {
      if (!staticServiceIncludedInPass(pass, feature.properties)) continue;
      const underground = boolean(feature.properties, 'underground');
      const paint = staticServicePassPaint(pass, feature.properties, routeCasingColor);
      pushLine(
        visuals,
        line({
          featureId: String(feature.id),
          source: 'services',
          coordinates: lngLatPath(feature.geometry.coordinates),
          properties: feature.properties,
          color: paint.color,
          widthPx: serviceWidth(feature.properties, zoom),
          ...(paint.marginPx === undefined ? {} : { marginPx: paint.marginPx }),
          baseOpacity: paint.baseOpacity,
          ...(underground ? { dashArray: [2.5, 2], lineCap: 'butt' } : {}),
        }),
      );
    }
  }
}

/** Resolve the static vector paint contract from the same stable-ID scene
 * consumed by MapLibre. The result intentionally contains plain numbers and
 * colors rather than MapLibre expressions, so SVG never guesses at a style
 * expression it cannot execute. */
export function resolveStaticVisualScene(
  input: ResolveStaticVisualSceneInput,
): ResolvedStaticVisualScene {
  const ordered = createOrderedSystemRenderVisuals({
    revision: input.revision,
    features: input.features,
    sourceIds: STATIC_SOURCE_IDS,
  });
  const { features } = ordered;
  const visuals: ResolvedStaticVisual[] = [];
  const zoom = input.presentation.zoom;
  const routeCasingColor = input.routeCasingColor ?? ROUTE_CASING;

  appendJunctionVisuals(features, visuals);
  appendWayVisuals(features, visuals, zoom, routeCasingColor);
  appendLaneVisuals(features, visuals);
  appendLaneMarkingVisuals(features, visuals);
  appendConnectorVisuals(features, visuals);
  appendServiceVisuals(features, visuals, zoom, routeCasingColor);

  return { scene: ordered.scene, features, visuals };
}
