import type { CurveControl } from './system';

/** Reassign curve controls when an authored point is inserted. */
export function curveControlsAfterPointInsertion(
  controls: readonly CurveControl[],
  index: number,
): CurveControl[] {
  return controls.map((control) => ({
    ...control,
    pointIndex: control.pointIndex >= index ? control.pointIndex + 1 : control.pointIndex,
  }));
}

/** Drop a removed point's curve and close the remaining index gap. */
export function curveControlsAfterPointDeletion(
  controls: readonly CurveControl[],
  index: number,
): CurveControl[] {
  return controls
    .filter((control) => control.pointIndex !== index)
    .map((control) => ({
      ...control,
      pointIndex: control.pointIndex > index ? control.pointIndex - 1 : control.pointIndex,
    }));
}

/** Split controls with their physical half. The new seam is an endpoint, so a
 * curve there has no adjacent segment pair and is deliberately discarded. */
export function splitCurveControls(
  controls: readonly CurveControl[],
  index: number,
): readonly [CurveControl[], CurveControl[]] {
  const first: CurveControl[] = [];
  const second: CurveControl[] = [];
  for (const control of controls) {
    if (control.pointIndex < index) first.push(control);
    else if (control.pointIndex > index) {
      second.push({ ...control, pointIndex: control.pointIndex - index });
    }
  }
  return [first, second];
}

/** Moves controls into another point-index coordinate system, preserving their
 * physical radius. Merge callers provide the topology's exact point map. */
export function remapCurveControls(
  controls: readonly CurveControl[],
  mapPointIndex: (pointIndex: number) => number,
): CurveControl[] {
  return controls.map((control) => ({ ...control, pointIndex: mapPointIndex(control.pointIndex) }));
}
