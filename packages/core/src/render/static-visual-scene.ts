import type { GeoJsonProperties } from 'geojson';
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
import {
  boolean,
  lngLatPath,
  numeric,
  resolvedPaintOpacity,
  text,
  tier,
  tierOpacity,
  type StaticVisualTier,
} from './static-visual-paint';
import { appendStaticWayVisuals } from './static-way-visuals';

export type { StaticVisualTier } from './static-visual-paint';

export type StaticVisualSource =
  'junctions' | 'lanes' | 'lane-markings' | 'connectors' | 'ways' | 'services';

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
  /** A one-pixel perimeter is resolved only where the geographic fill paints
   * one too; normal lane and junction surfaces remain unoutlined. */
  outlineColor?: string;
}

/** A control is an explicit point in the same junction source as its surface. */
export interface ResolvedStaticCircle extends ResolvedStaticVisualBase {
  kind: 'circle';
  coordinate: LngLat;
  radiusPx: number;
  color: string;
  outlineColor: string;
}

export type ResolvedStaticVisual =
  ResolvedStaticLine | ResolvedStaticPolygon | ResolvedStaticCircle;

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
  stops: systemFeatureSourceId('stations'),
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

function appendJunctionVisuals(features: SystemFeatures, visuals: ResolvedStaticVisual[]): void {
  for (const feature of features.junctions.features) {
    const resolvedTierOpacity = tierOpacity(feature.properties);
    // Junction asphalt is intentionally translucent so lane detail reads over
    // it. A control is a separate, legible traffic instruction at that same
    // node, matching the opaque MapLibre circle layer.
    const opacity = resolvedPaintOpacity(
      feature.properties,
      feature.geometry.type === 'Point' ? 1 : 0.9,
    );
    if (opacity <= 0) continue;
    if (feature.geometry.type === 'Point') {
      const control = junctionControlPaint(text(feature.properties, 'control', ''));
      if (!control) continue;
      visuals.push({
        kind: 'circle',
        featureId: String(feature.id),
        source: 'junctions',
        coordinate: lngLatPath([feature.geometry.coordinates])[0],
        radiusPx: control.radiusPx,
        color: control.color,
        outlineColor: control.outlineColor,
        renderTier: tier(feature.properties),
        tierOpacity: resolvedTierOpacity,
        opacity,
      });
      continue;
    }
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

function junctionControlPaint(
  control: string,
): { color: string; outlineColor: string; radiusPx: number } | null {
  if (control === 'signal') return { color: '#b23b2e', outlineColor: '#191a17', radiusPx: 4.5 };
  if (control === 'stop') return { color: '#f4f2ec', outlineColor: '#191a17', radiusPx: 4.5 };
  if (control === 'yield') return { color: '#d9a62e', outlineColor: '#191a17', radiusPx: 3.5 };
  if (control === 'roundabout') return { color: '#d9a62e', outlineColor: '#191a17', radiusPx: 5.5 };
  if (control === 'levelCrossing')
    return { color: '#191a17', outlineColor: '#f4f2ec', radiusPx: 4 };
  return null;
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
  if (kind === 'crosswalk') return { color: LANE_MARKING, width: 1.8, opacity: 0.9 };
  if (kind === 'stopBar') return { color: LANE_MARKING, width: 2.5, opacity: 0.95 };
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
  for (const kind of [
    'railTie',
    'rail',
    'thinLane',
    'laneLine',
    'edgeLine',
    'centerLine',
    'crosswalk',
    'stopBar',
  ]) {
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

function appendWayVisuals(
  features: SystemFeatures,
  visuals: ResolvedStaticVisual[],
  zoom: number,
  routeCasingColor: string,
): void {
  const passes = [
    { dashed: false, casing: true },
    { dashed: false, casing: false },
    { dashed: true, casing: true },
    { dashed: true, casing: false },
  ];
  for (const pass of passes) {
    appendStaticWayVisuals({
      features: features.ways.features,
      visuals,
      zoom,
      routeCasingColor,
      ...pass,
    });
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
