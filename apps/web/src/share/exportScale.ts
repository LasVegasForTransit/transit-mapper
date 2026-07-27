import type { Map as MLMap } from 'maplibre-gl';
import { haversineMeters } from '@transitmapper/core/model/geo';
import { scaleBarFor, type ScaleBarSpec } from '@transitmapper/core/render/scaleBar';

// The nice-number rounding and label formatting moved to core (render/
// scaleBar.ts) so the Worker can size a scale bar for a server-rendered
// preview too. Re-exported here so existing importers — and the tests that
// cover the rounding rules — don't need to care where the math lives.
export { formatScaleMeters, niceScaleMeters } from '@transitmapper/core/render/scaleBar';
export type { ScaleBarSpec };

/** A scale bar sized against the given map's current zoom: the widest "nice"
 *  round-number distance whose bar still fits under `maxWidthPx`. Measures
 *  ground resolution by unprojecting two points on the live map, which stays
 *  honest under pitch — where core's pure mercator estimate would not. */
export function scaleBarSpec(map: MLMap, maxWidthPx: number): ScaleBarSpec {
  const container = map.getContainer();
  const y = container.clientHeight / 2;
  const a = map.unproject([0, y]);
  const b = map.unproject([maxWidthPx, y]);
  const metersPerPixel = haversineMeters([a.lng, a.lat], [b.lng, b.lat]) / maxWidthPx;
  return scaleBarFor(metersPerPixel, maxWidthPx);
}
