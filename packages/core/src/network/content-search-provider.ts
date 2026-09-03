import type { GeographicBounds, LngLat } from '../geography/bounds';
import type { TransitEntityRef } from '../model/transit-entity-ref';
import type { ResolveOptions } from './content-provider';
import type { ResolvedContentRef } from './resolved-content-reference';

export interface ContentSearchQuery {
  text: string;
  bounds?: GeographicBounds;
  kinds?: readonly TransitEntityRef['kind'][];
  limit: number;
  cursor?: string;
}

export interface ContentSearchItem {
  entity: TransitEntityRef;
  label: string;
  location?: LngLat;
  extent?: GeographicBounds;
}

export interface ContentSearchResult {
  items: readonly ContentSearchItem[];
  nextCursor?: string;
}

export interface ContentSearchProvider {
  search(
    content: ResolvedContentRef,
    query: ContentSearchQuery,
    options?: ResolveOptions,
  ): Promise<ContentSearchResult>;
}
