import type { Feature, Geometry } from 'geojson';
import type { RenderPresentation } from './render-presentation';

const WEB_MERCATOR_TILE_SIZE = 512;
const MAX_MERCATOR_LATITUDE = 85.051129;

/** A marker that competes with nearby markers for one visible screen cell.
 *
 * The caller supplies a stable id and an explicit importance rank. The helper
 * keeps the highest rank in each cell, then uses the id only when two markers
 * have equal importance. That makes the result independent of input order.
 */
export interface ScreenDensityCandidate {
  readonly id: string;
  readonly coordinate: readonly [number, number];
  readonly priority: number;
}

/** A source-specific rule for markers that compete for one screen cell. */
export interface ScreenDensityPolicy {
  readonly cellSizePx: number;
  candidate(feature: Feature): ScreenDensityCandidate | null;
}

export interface ScreenDensitySelector {
  consider(candidate: ScreenDensityCandidate): void;
  keeps(id: string): boolean;
}

interface ScreenCellCoordinate {
  readonly x: number;
  readonly y: number;
}

function mercatorCoordinate([longitude, latitude]: readonly [
  number,
  number,
]): ScreenCellCoordinate {
  const clampedLatitude = Math.max(
    -MAX_MERCATOR_LATITUDE,
    Math.min(MAX_MERCATOR_LATITUDE, latitude),
  );
  const latitudeRadians = (clampedLatitude * Math.PI) / 180;
  return {
    x: (longitude + 180) / 360,
    y: 0.5 - Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2)) / (2 * Math.PI),
  };
}

function screenCellKey(
  coordinate: readonly [number, number],
  presentation: RenderPresentation,
  cellSizePx: number,
): string {
  const worldSize = WEB_MERCATOR_TILE_SIZE * 2 ** presentation.zoom;
  const mercator = mercatorCoordinate(coordinate);
  const displayedX =
    (mercator.x * worldSize * presentation.displayedWidthPx) / presentation.viewportWidthPx;
  const displayedY =
    (mercator.y * worldSize * presentation.displayedHeightPx) / presentation.viewportHeightPx;
  return `${Math.floor(displayedX / cellSizePx)}:${Math.floor(displayedY / cellSizePx)}`;
}

function winsDensityCell(
  candidate: ScreenDensityCandidate,
  current: ScreenDensityCandidate,
): boolean {
  return (
    candidate.priority > current.priority ||
    (candidate.priority === current.priority && candidate.id < current.id)
  );
}

class DensitySelector implements ScreenDensitySelector {
  private readonly winners = new Map<string, ScreenDensityCandidate>();
  private readonly winnerIds = new Set<string>();

  constructor(
    private readonly presentation: RenderPresentation,
    private readonly cellSizePx: number,
  ) {}

  consider(candidate: ScreenDensityCandidate): void {
    const cell = screenCellKey(candidate.coordinate, this.presentation, this.cellSizePx);
    const current = this.winners.get(cell);
    if (current && !winsDensityCell(candidate, current)) return;
    if (current) this.winnerIds.delete(current.id);
    this.winners.set(cell, candidate);
    this.winnerIds.add(candidate.id);
  }

  keeps(id: string): boolean {
    return this.winnerIds.has(id);
  }
}

/** Creates a selector that can consume a source a bounded chunk at a time. */
export function createScreenDensitySelector(
  presentation: RenderPresentation,
  cellSizePx: number,
): ScreenDensitySelector {
  if (!Number.isFinite(cellSizePx) || cellSizePx <= 0) {
    throw new RangeError('Screen-density cell size must be a finite positive CSS-pixel value.');
  }
  return new DensitySelector(presentation, cellSizePx);
}

function pointCandidate(feature: Feature, priority: number): ScreenDensityCandidate | null {
  if (typeof feature.id !== 'string' || feature.geometry.type !== 'Point') return null;
  const [longitude, latitude] = feature.geometry.coordinates;
  if (typeof longitude !== 'number' || typeof latitude !== 'number') return null;
  return { id: feature.id, coordinate: [longitude, latitude], priority };
}

function lineCandidate(feature: Feature): ScreenDensityCandidate | null {
  if (typeof feature.id !== 'string' || feature.geometry.type !== 'LineString') return null;
  const coordinates = feature.geometry.coordinates;
  const coordinate = coordinates.at(Math.floor(coordinates.length / 2));
  if (!coordinate || typeof coordinate[0] !== 'number' || typeof coordinate[1] !== 'number') {
    return null;
  }
  return { id: feature.id, coordinate: [coordinate[0], coordinate[1]], priority: 0 };
}

const STOP_POLICY: ScreenDensityPolicy = {
  cellSizePx: 32,
  candidate: (feature) => {
    const properties = feature.properties;
    const priority = properties?.interchange === true ? 2 : properties?.major === true ? 1 : 0;
    return pointCandidate(feature, priority);
  },
};

const FACILITY_POLICY: ScreenDensityPolicy = {
  cellSizePx: 40,
  candidate: (feature) => pointCandidate(feature, feature.properties?.name ? 1 : 0),
};

const ARROW_POLICY: ScreenDensityPolicy = { cellSizePx: 72, candidate: lineCandidate };
const LABEL_POLICY: ScreenDensityPolicy = { cellSizePx: 112, candidate: lineCandidate };

/** Returns the one density rule that owns a source. Editor controls never
 * enter this table because an editing affordance must not disappear merely
 * because another control is nearby. */
export function screenDensityPolicy(sourceName: string): ScreenDensityPolicy | null {
  switch (sourceName) {
    case 'stops':
      return STOP_POLICY;
    case 'facilities':
      return FACILITY_POLICY;
    case 'laneArrows':
    case 'serviceArrows':
      return ARROW_POLICY;
    case 'wayLabels':
      return LABEL_POLICY;
    default:
      return null;
  }
}

/** Selects one deterministic representative for every final-display cell.
 *
 * The grid uses world pixels, not viewport pixels. A same-scale pan therefore
 * keeps the accepted marker set stable and can reuse the current scene. Final
 * display dimensions affect the grid because a half-size export has half as
 * much readable marker space as its authoring canvas.
 */
export function screenDensity<Candidate extends ScreenDensityCandidate>(
  candidates: readonly Candidate[],
  presentation: RenderPresentation,
  cellSizePx: number,
): Candidate[] {
  const selector = createScreenDensitySelector(presentation, cellSizePx);
  for (const candidate of candidates) selector.consider(candidate);
  return candidates.filter(({ id }) => selector.keeps(id));
}

/** Applies one source's rule after every candidate is available. The live
 * renderer invokes this through resumable aggregation; direct static callers
 * invoke it here because they already hold a complete source collection. */
export function applyScreenDensity<GeometryType extends Geometry>(
  sourceName: string,
  features: Feature<GeometryType>[],
  presentation: RenderPresentation,
): Feature<GeometryType>[] {
  const policy = screenDensityPolicy(sourceName);
  if (!policy) return features;
  const entries = features.map((feature) => ({ feature, candidate: policy.candidate(feature) }));
  const selector = createScreenDensitySelector(presentation, policy.cellSizePx);
  for (const { candidate } of entries) {
    if (candidate) selector.consider(candidate);
  }
  return entries
    .filter(({ feature, candidate }) => !candidate || selector.keeps(String(feature.id)))
    .map(({ feature }) => feature);
}
