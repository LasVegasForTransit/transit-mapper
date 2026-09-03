export type NormalizedRange = readonly [number, number];

export function sameNormalizedRange(left: NormalizedRange, right: NormalizedRange): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

export function mapNormalizedPosition(
  position: number,
  source: NormalizedRange,
  target: NormalizedRange,
): number {
  if (position === source[0]) return target[0];
  if (position === source[1]) return target[1];
  const progress = (position - source[0]) / (source[1] - source[0]);
  return target[0] + progress * (target[1] - target[0]);
}

export function mapNormalizedRange(
  range: NormalizedRange,
  source: NormalizedRange,
  target: NormalizedRange,
): NormalizedRange {
  return [
    mapNormalizedPosition(range[0], source, target),
    mapNormalizedPosition(range[1], source, target),
  ];
}
