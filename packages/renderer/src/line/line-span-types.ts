import type { LineString } from 'geojson';
import type { TransitCarrierRef } from '@transitmapper/core/transit/value-types';

export interface LineSpanContributor {
  readonly servicePlanId: string;
  readonly patternId: string;
  readonly legIndex: number;
  readonly carrier: TransitCarrierRef;
  readonly carrierRange: readonly [number, number];
  readonly spanRange: readonly [number, number];
}

export interface LineSpan {
  readonly id: string;
  readonly lineId: string;
  readonly contributors: readonly LineSpanContributor[];
  readonly canonicalCarrier: TransitCarrierRef;
  readonly canonicalCarrierRange: readonly [number, number];
}

export interface VisibleLineSpanFragment {
  readonly id: string;
  readonly lineSpanId: string;
  readonly canonicalCarrierRange: readonly [number, number];
  readonly sourceShardIds: readonly [string, ...string[]];
  readonly geometry: LineString;
}
