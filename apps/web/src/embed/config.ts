import {
  LAYER_SPECS,
  SRC_FACILITIES,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_WAYS,
} from '../map/layers';

/** The read-only schematic never writes editor previews, handles, lanes,
 * simulation vehicles, or marquee data. Omitting both their sources and
 * layers reduces MapLibre worker setup and source bookkeeping in every iframe. */
export const EMBED_SOURCE_IDS: ReadonlySet<string> = new Set([
  SRC_WAYS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_FOOTPRINTS,
  SRC_PLATFORMS,
  SRC_FACILITIES,
]);

export const EMBED_LAYER_SPECS = LAYER_SPECS.filter(
  (spec) =>
    'source' in spec && typeof spec.source === 'string' && EMBED_SOURCE_IDS.has(spec.source),
);
