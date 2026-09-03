import { describe, expect, it } from 'vitest';
import type { ContentRef } from '../../../src/network/content-reference';
import type { ContentProvider } from '../../../src/network/content-provider';
import type { NetworkQuery } from '../../../src/network/query';
import type { ResolvedContentRef } from '../../../src/network/resolved-content-reference';
import { waitForProviderAbort } from '../../support/provider-abort.test';

const reference: ContentRef = {
  kind: 'transit-system',
  id: 'las-vegas',
  revision: { kind: 'latest' },
};

const content: ResolvedContentRef = {
  kind: 'transit-system',
  id: 'las-vegas',
  revision: {
    kind: 'working',
    contentDigest: { algorithm: 'sha-256', value: 'a'.repeat(64) },
  },
};

const query: NetworkQuery = {
  serviceTime: { kind: 'live' },
  modes: { kind: 'all' },
  filters: {},
  bounds: { kind: 'ordinary', west: -116, south: 35, east: -114, north: 37 },
  detailBand: 'district',
};

describe('content provider port', () => {
  it('passes cancellation into description and network resolution work', async () => {
    const provider: ContentProvider = {
      describe: (_reference, options) => waitForProviderAbort('Provider request aborted.', options),
      resolve: (_content, _query, options) =>
        waitForProviderAbort('Provider request aborted.', options),
    };
    const describeController = new AbortController();
    const resolveController = new AbortController();
    const description = provider.describe(reference, { signal: describeController.signal });
    const network = provider.resolve(content, query, { signal: resolveController.signal });

    describeController.abort();
    resolveController.abort();

    await expect(description).rejects.toThrow('Provider request aborted.');
    await expect(network).rejects.toThrow('Provider request aborted.');
  });
});
