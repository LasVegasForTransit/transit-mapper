import type { LayerSpecification } from 'maplibre-gl';
import type { ViewOptions } from '@transitmapper/core/render/buildFeatures';
import {
  LYR_LINE_CASING,
  LYR_LINE_STRIPE,
  LYR_LINE_STRIPE_SELECTED,
  LYR_LINE_STRIPE_HIT,
  SRC_HIT_FEATURES,
  SRC_LANDMARKS,
  SRC_SERVICES,
  SRC_SERVICE_ARROWS,
  SRC_STATIONS,
  SRC_WAYS,
  SRC_WAY_LABELS,
} from './layers/constants';
import { COMMITTED_SYSTEM_FEATURE_SOURCES } from './system-feature-sources';

const NETWORK_ONLY_LAYER_IDS: ReadonlySet<string> = new Set([
  LYR_LINE_CASING,
  LYR_LINE_STRIPE,
  LYR_LINE_STRIPE_SELECTED,
  LYR_LINE_STRIPE_HIT,
]);

const NETWORK_SOURCES: ReadonlySet<string> = new Set([
  SRC_WAYS,
  SRC_SERVICES,
  SRC_STATIONS,
  SRC_SERVICE_ARROWS,
  SRC_WAY_LABELS,
  SRC_LANDMARKS,
]);
const DIAGRAM_SOURCES: ReadonlySet<string> = new Set([
  SRC_WAYS,
  SRC_SERVICES,
  SRC_HIT_FEATURES,
  SRC_STATIONS,
  SRC_SERVICE_ARROWS,
  SRC_WAY_LABELS,
]);
const INFRASTRUCTURE_SOURCES: ReadonlySet<string> = new Set([
  ...COMMITTED_SYSTEM_FEATURE_SOURCES,
  SRC_HIT_FEATURES,
  SRC_LANDMARKS,
]);

function layerSource(spec: LayerSpecification): string | null {
  return 'source' in spec && typeof spec.source === 'string' ? spec.source : null;
}

export function documentLayerSpecsForViewMode(
  specs: readonly LayerSpecification[],
  viewMode: ViewOptions['viewMode'],
): LayerSpecification[] {
  const allowed =
    viewMode === 'infrastructure'
      ? INFRASTRUCTURE_SOURCES
      : viewMode === 'diagram'
        ? DIAGRAM_SOURCES
        : NETWORK_SOURCES;
  return specs.filter((spec) => {
    if (viewMode !== 'network' && NETWORK_ONLY_LAYER_IDS.has(spec.id)) return false;
    const source = layerSource(spec);
    return source !== null && allowed.has(source);
  });
}
