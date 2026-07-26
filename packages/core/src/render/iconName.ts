// The naming half of the app's on-map icon registry, split out from
// map/icons.ts (which rasterizes glyphs through a DOM canvas and so can only
// run in a browser). buildFeatures only ever needs the *name* — the actual
// image registration stays in the web app. Keeping the pure half here is what
// lets the Worker build the same features without a DOM.

/** Deterministic registered-image name for a (glyph, color) pair. */
export function iconName(pathKey: string, color: string): string {
  return `tm-icon-${pathKey}-${color}`;
}
