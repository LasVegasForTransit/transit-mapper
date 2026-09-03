import { describe, expect, it } from 'vitest';
import type {
  ContentSearchProvider,
  ContentSearchQuery,
  ContentSearchResult,
} from '../../../src/network/content-search-provider';
import type { ResolvedContentRef } from '../../../src/network/resolved-content-reference';
import { waitForProviderAbort } from '../../support/provider-abort.test';

const content: ResolvedContentRef = {
  kind: 'transit-dataset',
  id: 'southern-nevada',
  datasetRevisionId: 'revision-7',
  operational: { kind: 'planned' },
};

const query: ContentSearchQuery = {
  text: 'Centennial',
  bounds: { kind: 'ordinary', west: -116, south: 35, east: -114, north: 37 },
  kinds: ['line', 'stop', 'station'],
  limit: 20,
};

const result: ContentSearchResult = {
  items: [
    {
      entity: { kind: 'station', id: 'station-centennial' },
      label: 'Centennial Hills',
      location: [-115.31, 36.28],
    },
    {
      entity: { kind: 'line', id: 'line-220' },
      label: '220 Ann / Tropical',
      extent: { kind: 'ordinary', west: -115.4, south: 36.2, east: -115.1, north: 36.3 },
    },
  ],
  nextCursor: 'search-page-2',
};

describe('content search provider port', () => {
  it('returns bounded semantic identities without provider records', () => {
    expect(result.items.map(({ entity }) => entity.kind)).toEqual(['station', 'line']);
    expect(result.items[0]?.location).toEqual([-115.31, 36.28]);
    expect(result.items[1]?.extent).toMatchObject({ west: -115.4, east: -115.1 });
  });

  it('passes cancellation into search work', async () => {
    const provider: ContentSearchProvider = {
      search: (_content, _query, options) =>
        waitForProviderAbort('Search request aborted.', options),
    };
    const controller = new AbortController();
    const search = provider.search(content, query, { signal: controller.signal });

    controller.abort();

    await expect(search).rejects.toThrow('Search request aborted.');
  });
});
