import type { LngLat } from '@transitmapper/core/geography/bounds';
import { EARTH_RADIUS_M, toRad } from '@transitmapper/core/model/geo/spherical';
import type { TransitEntityKey } from '@transitmapper/core/model/transit-entity-ref';

const millimetresPerMetre = 1_000;
const maximumSampleSegmentM = 40;
const minimumCandidateLengthM = 25;
const maximumSeparationM = 20;
const undirectedHeadingThreshold = 0.5868240888334652;
const antipodalEpsilonRad = 1e-12;

interface MetricPoint {
  readonly x: number;
  readonly y: number;
}

interface MetricSegment {
  readonly start: MetricPoint;
  readonly tangent: MetricPoint;
  readonly lengthM: number;
}

interface ProjectionOrigin {
  readonly longitudeRad: number;
  readonly latitudeRad: number;
}

interface EndpointVector {
  readonly anchorKey: TransitEntityKey;
  readonly identityOrderKey: Uint8Array;
  readonly point: LngLat;
}

interface MutableCenterline {
  nextPointIndex: number;
  previousPoint?: MetricPoint;
  readonly segments: MetricSegment[];
  totalLengthM: number;
  lengthM?: number;
}

type ComparisonPhase = 'project-left' | 'project-right' | 'compare-left' | 'compare-right';

export interface TopologyMetricPath {
  readonly identityOrderKey: Uint8Array;
  readonly startAnchorKey: TransitEntityKey;
  readonly endAnchorKey: TransitEntityKey;
  readonly points: readonly [LngLat, LngLat, ...LngLat[]];
}

export interface CompareTopologyCandidateInput {
  readonly left: TopologyMetricPath;
  readonly right: TopologyMetricPath;
}

type TopologyCandidateRejectionReason =
  | 'invalid-origin'
  | 'invalid-coordinate'
  | 'degenerate-centerline'
  | 'too-short'
  | 'too-far'
  | 'heading-conflict';

export type TopologyCandidateResult =
  | {
      readonly kind: 'accepted';
      readonly leftLengthM: number;
      readonly rightLengthM: number;
      readonly shorterLengthM: number;
      readonly maximumDistanceM: number;
    }
  | {
      readonly kind: 'rejected';
      readonly reason: TopologyCandidateRejectionReason;
    };

type TopologyCandidateComparisonProgress = { readonly kind: 'pending' } | TopologyCandidateResult;

export interface TopologyCandidateComparison {
  advance(operationBudget: number): TopologyCandidateComparisonProgress;
}

export interface NearestTopologyTangent {
  readonly distanceM: number;
  readonly hasMatchingHeading: boolean;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function compareEndpoints(left: EndpointVector, right: EndpointVector): number {
  const anchorOrder =
    left.anchorKey < right.anchorKey ? -1 : left.anchorKey > right.anchorKey ? 1 : 0;
  if (anchorOrder !== 0) return anchorOrder;
  return compareBytes(left.identityOrderKey, right.identityOrderKey);
}

function pathEndpoints(path: TopologyMetricPath): readonly [EndpointVector, EndpointVector] {
  return [
    {
      anchorKey: path.startAnchorKey,
      identityOrderKey: path.identityOrderKey,
      point: path.points[0],
    },
    {
      anchorKey: path.endAnchorKey,
      identityOrderKey: path.identityOrderKey,
      point: path.points[path.points.length - 1],
    },
  ];
}

function coordinateIsFinite(point: LngLat): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function projectionOrigin(input: CompareTopologyCandidateInput): ProjectionOrigin | null {
  const endpoints = [...pathEndpoints(input.left), ...pathEndpoints(input.right)].sort(
    compareEndpoints,
  );
  let x = 0;
  let y = 0;
  let z = 0;
  for (const endpoint of endpoints) {
    const longitudeRad = toRad(endpoint.point[0]);
    const latitudeRad = toRad(endpoint.point[1]);
    const latitudeCosine = Math.cos(latitudeRad);
    x += latitudeCosine * Math.cos(longitudeRad);
    y += latitudeCosine * Math.sin(longitudeRad);
    z += Math.sin(latitudeRad);
  }
  const magnitude = Math.hypot(x, y, z);
  if (!Number.isFinite(magnitude) || magnitude === 0) return null;
  return {
    longitudeRad: Math.atan2(y / magnitude, x / magnitude),
    latitudeRad: Math.asin(Math.max(-1, Math.min(1, z / magnitude))),
  };
}

function wrapLongitudeRadians(value: number): number {
  const period = Math.PI * 2;
  return ((((value + Math.PI) % period) + period) % period) - Math.PI;
}

export function quantizeOverlapMetres(value: number): number {
  if (value === 0) return 0;
  return (
    (Math.sign(value) * Math.floor(Math.abs(value) * millimetresPerMetre + 0.5)) /
    millimetresPerMetre
  );
}

function projectPoint(point: LngLat, origin: ProjectionOrigin): MetricPoint | null {
  const longitudeRad = toRad(point[0]);
  const latitudeRad = toRad(point[1]);
  const deltaLongitude = wrapLongitudeRadians(longitudeRad - origin.longitudeRad);
  const originLatitudeSine = Math.sin(origin.latitudeRad);
  const originLatitudeCosine = Math.cos(origin.latitudeRad);
  const latitudeSine = Math.sin(latitudeRad);
  const latitudeCosine = Math.cos(latitudeRad);
  const cosineDistance = Math.max(
    -1,
    Math.min(
      1,
      originLatitudeSine * latitudeSine +
        originLatitudeCosine * latitudeCosine * Math.cos(deltaLongitude),
    ),
  );
  const angularDistance = Math.acos(cosineDistance);
  if (!Number.isFinite(angularDistance) || angularDistance >= Math.PI - antipodalEpsilonRad) {
    return null;
  }
  const scale = angularDistance === 0 ? 1 : angularDistance / Math.sin(angularDistance);
  const x = EARTH_RADIUS_M * scale * latitudeCosine * Math.sin(deltaLongitude);
  const y =
    EARTH_RADIUS_M *
    scale *
    (originLatitudeCosine * latitudeSine -
      originLatitudeSine * latitudeCosine * Math.cos(deltaLongitude));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: quantizeOverlapMetres(x), y: quantizeOverlapMetres(y) };
}

function samePoint(left: MetricPoint, right: MetricPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function emptyCenterline(): MutableCenterline {
  return { nextPointIndex: 0, segments: [], totalLengthM: 0 };
}

function nearestDistance(sample: MetricPoint, segment: MetricSegment): number {
  const squaredLength = segment.tangent.x ** 2 + segment.tangent.y ** 2;
  const offsetX = sample.x - segment.start.x;
  const offsetY = sample.y - segment.start.y;
  const fraction = Math.max(
    0,
    Math.min(1, (offsetX * segment.tangent.x + offsetY * segment.tangent.y) / squaredLength),
  );
  const nearestX = segment.start.x + fraction * segment.tangent.x;
  const nearestY = segment.start.y + fraction * segment.tangent.y;
  return Math.hypot(sample.x - nearestX, sample.y - nearestY);
}

function headingsMatch(left: MetricPoint, right: MetricPoint): boolean {
  const dot = left.x * right.x + left.y * right.y;
  const leftSquared = left.x ** 2 + left.y ** 2;
  const rightSquared = right.x ** 2 + right.y ** 2;
  return dot ** 2 >= undirectedHeadingThreshold * leftSquared * rightSquared;
}

export function retainNearestTopologyTangent(
  current: NearestTopologyTangent | undefined,
  rawDistanceM: number,
  headingMatches: boolean,
): NearestTopologyTangent {
  const distanceM = quantizeOverlapMetres(rawDistanceM);
  if (current === undefined || distanceM < current.distanceM) {
    return { distanceM, hasMatchingHeading: headingMatches };
  }
  if (distanceM === current.distanceM && headingMatches && !current.hasMatchingHeading) {
    return { distanceM, hasMatchingHeading: true };
  }
  return current;
}

class ResumableTopologyCandidateComparison implements TopologyCandidateComparison {
  private readonly input: CompareTopologyCandidateInput;
  private readonly origin: ProjectionOrigin | null;
  private readonly left = emptyCenterline();
  private readonly right = emptyCenterline();
  private phase: ComparisonPhase = 'project-left';
  private result?: TopologyCandidateResult;
  private sourceSegmentIndex = 0;
  private sourceSampleIndex = 0;
  private targetSegmentIndex = 0;
  private nearestSample?: NearestTopologyTangent;
  private directionMaximumDistanceM = 0;
  private leftToRightMaximumDistanceM = 0;

  constructor(input: CompareTopologyCandidateInput) {
    this.input = input;
    const endpoints = [...pathEndpoints(input.left), ...pathEndpoints(input.right)];
    if (!endpoints.every((endpoint) => coordinateIsFinite(endpoint.point))) {
      this.origin = null;
      this.result = { kind: 'rejected', reason: 'invalid-coordinate' };
      return;
    }
    this.origin = projectionOrigin(input);
    if (this.origin === null) this.result = { kind: 'rejected', reason: 'invalid-origin' };
  }

  advance(operationBudget: number): TopologyCandidateComparisonProgress {
    if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
      throw new RangeError('Topology comparison operation budget must be a positive integer.');
    }
    if (this.result !== undefined) return this.result;
    for (let operation = 0; operation < operationBudget; operation += 1) {
      const result = this.performOperation();
      if (result !== undefined) return result;
    }
    return { kind: 'pending' };
  }

  private performOperation(): TopologyCandidateResult | undefined {
    if (this.phase === 'project-left' || this.phase === 'project-right') {
      this.advanceProjection();
    } else {
      this.advanceDistanceComparison();
    }
    return this.result;
  }

  private advanceProjection(): void {
    const path = this.phase === 'project-left' ? this.input.left : this.input.right;
    const centerline = this.phase === 'project-left' ? this.left : this.right;
    const geographicPoint = path.points[centerline.nextPointIndex];
    if (!coordinateIsFinite(geographicPoint)) {
      this.result = { kind: 'rejected', reason: 'invalid-coordinate' };
      return;
    }
    if (this.origin === null) throw new Error('Topology comparison lost its projection origin.');
    const point = projectPoint(geographicPoint, this.origin);
    if (point === null) {
      this.result = { kind: 'rejected', reason: 'invalid-coordinate' };
      return;
    }
    if (centerline.previousPoint === undefined) {
      centerline.previousPoint = point;
    } else if (!samePoint(centerline.previousPoint, point)) {
      const tangent = {
        x: point.x - centerline.previousPoint.x,
        y: point.y - centerline.previousPoint.y,
      };
      const lengthM = Math.hypot(tangent.x, tangent.y);
      centerline.segments.push({ start: centerline.previousPoint, tangent, lengthM });
      centerline.totalLengthM += lengthM;
      centerline.previousPoint = point;
    }
    centerline.nextPointIndex += 1;
    if (centerline.nextPointIndex < path.points.length) return;
    if (centerline.segments.length === 0) {
      this.result = { kind: 'rejected', reason: 'degenerate-centerline' };
      return;
    }
    centerline.lengthM = quantizeOverlapMetres(centerline.totalLengthM);
    if (this.phase === 'project-left') {
      this.phase = 'project-right';
      return;
    }
    const shorterLengthM = Math.min(this.left.lengthM ?? 0, this.right.lengthM ?? 0);
    if (shorterLengthM < minimumCandidateLengthM) {
      this.result = { kind: 'rejected', reason: 'too-short' };
      return;
    }
    this.phase = 'compare-left';
  }

  private currentCenterlines(): {
    readonly source: MutableCenterline;
    readonly target: MutableCenterline;
  } {
    return this.phase === 'compare-left'
      ? { source: this.left, target: this.right }
      : { source: this.right, target: this.left };
  }

  private currentSample(segment: MetricSegment): MetricPoint {
    const divisions = Math.max(1, Math.ceil(segment.lengthM / maximumSampleSegmentM));
    const fraction = this.sourceSampleIndex / divisions;
    return {
      x: segment.start.x + segment.tangent.x * fraction,
      y: segment.start.y + segment.tangent.y * fraction,
    };
  }

  private advanceDistanceComparison(): void {
    const { source, target } = this.currentCenterlines();
    if (this.sourceSegmentIndex >= source.segments.length) {
      this.completeDirection();
      return;
    }
    const sourceSegment = source.segments[this.sourceSegmentIndex];
    const targetSegment = target.segments[this.targetSegmentIndex];
    this.nearestSample = retainNearestTopologyTangent(
      this.nearestSample,
      nearestDistance(this.currentSample(sourceSegment), targetSegment),
      headingsMatch(sourceSegment.tangent, targetSegment.tangent),
    );
    this.targetSegmentIndex += 1;
    if (this.targetSegmentIndex < target.segments.length) return;
    this.completeSample(sourceSegment);
  }

  private completeSample(sourceSegment: MetricSegment): void {
    const nearestSample = this.nearestSample;
    if (nearestSample === undefined) {
      throw new Error('Topology comparison found no target segment for a sample.');
    }
    this.directionMaximumDistanceM = Math.max(
      this.directionMaximumDistanceM,
      nearestSample.distanceM,
    );
    if (nearestSample.distanceM > maximumSeparationM) {
      this.result = { kind: 'rejected', reason: 'too-far' };
      return;
    }
    if (!nearestSample.hasMatchingHeading) {
      this.result = { kind: 'rejected', reason: 'heading-conflict' };
      return;
    }
    const divisions = Math.max(1, Math.ceil(sourceSegment.lengthM / maximumSampleSegmentM));
    if (this.sourceSampleIndex < divisions) {
      this.sourceSampleIndex += 1;
    } else {
      this.sourceSegmentIndex += 1;
      this.sourceSampleIndex = 0;
    }
    this.targetSegmentIndex = 0;
    this.nearestSample = undefined;
  }

  private completeDirection(): void {
    if (this.phase === 'compare-left') {
      this.leftToRightMaximumDistanceM = this.directionMaximumDistanceM;
      this.phase = 'compare-right';
      this.sourceSegmentIndex = 0;
      this.sourceSampleIndex = 0;
      this.targetSegmentIndex = 0;
      this.nearestSample = undefined;
      this.directionMaximumDistanceM = 0;
      return;
    }
    const leftLengthM = this.left.lengthM;
    const rightLengthM = this.right.lengthM;
    if (leftLengthM === undefined || rightLengthM === undefined) {
      throw new Error('Topology comparison completed before it measured both centerlines.');
    }
    this.result = {
      kind: 'accepted',
      leftLengthM,
      rightLengthM,
      shorterLengthM: Math.min(leftLengthM, rightLengthM),
      maximumDistanceM: Math.max(this.leftToRightMaximumDistanceM, this.directionMaximumDistanceM),
    };
  }
}

export function createTopologyCandidateComparison(
  input: CompareTopologyCandidateInput,
): TopologyCandidateComparison {
  return new ResumableTopologyCandidateComparison(input);
}
