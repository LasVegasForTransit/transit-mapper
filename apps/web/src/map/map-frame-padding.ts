/**
 * MapLibre 6 types `PaddingOptions` as "at least one side", so every reader of
 * a padding value has to re-check each side. The editor always computes all
 * four from the surrounding chrome, so it names the complete shape instead.
 *
 * This lives in its own module because the map surface, the editor ports, and
 * the editor view all need it, and importing it from any of those would close
 * a cycle between them.
 */
export interface MapFramePadding {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}
