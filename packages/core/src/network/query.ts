import type { GeographicBounds } from '../geography/bounds';

export type DetailBand = 'overview' | 'district' | 'street';
export type ViewFilterValue = boolean | string | readonly string[];
export type ModeSelection = { kind: 'all' } | { kind: 'only'; ids: readonly string[] };

export interface ViewQuery {
  serviceTime: { kind: 'live' } | { kind: 'instant'; value: string };
  modes: ModeSelection;
  filters: Readonly<Record<string, ViewFilterValue>>;
}

export interface NetworkQuery extends ViewQuery {
  bounds: GeographicBounds;
  detailBand: DetailBand;
  cursor?: string;
}
