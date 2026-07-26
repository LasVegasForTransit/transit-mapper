// Scale-bar sizing, with the map taken out. This started in the web app's
// export code, where the only way to ask "how many meters is a pixel?" was to
// unproject two points on a live map. Everything here now takes that number as
// an argument instead, so the Worker can size a scale bar for a server-rendered
// preview the same way the app sizes one for an export.

// A "nice" length for a scale bar — 1/2/5 × a power of ten — the same
// rounding cartographers use so the label reads as a round number instead of
// something like "347 m".
const NICE_STEPS = [1, 2, 5];

export function niceScaleMeters(targetMeters: number): number {
  if (targetMeters <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(targetMeters));
  const candidates = NICE_STEPS.map((s) => s * magnitude);
  // The largest nice candidate that still fits under the target — a scale
  // bar that reads longer than the distance it claims would be worse than
  // a slightly conservative one.
  return [...candidates].reverse().find((c) => c <= targetMeters) ?? candidates[0];
}

export function formatScaleMeters(meters: number): string {
  return meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
}

export interface ScaleBarSpec {
  widthPx: number;
  label: string;
}

/** The widest "nice" round-number distance whose bar still fits under
 *  `maxWidthPx`, at the given ground resolution. */
export function scaleBarFor(metersPerPixel: number, maxWidthPx: number): ScaleBarSpec {
  const niceMeters = niceScaleMeters(metersPerPixel * maxWidthPx);
  return { widthPx: niceMeters / metersPerPixel, label: formatScaleMeters(niceMeters) };
}
