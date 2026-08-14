/**
 * Resolved drawing records shared by static render passes.
 *
 * A static surface receives these records after the renderer has selected a
 * tier, width, colour, and opacity. Pass helpers can append records without
 * depending on the scene builder that owns their final ordering.
 */
import type { LngLat } from '../model/system';
import type { StaticVisualTier } from './static-visual-paint';

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
