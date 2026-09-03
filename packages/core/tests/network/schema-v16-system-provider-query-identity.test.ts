import { describe, expect, it } from 'vitest';
import { canonicalValueBytes } from '../../src/encoding/canonical-value';
import type { TransitSystem } from '../../src/model/system';
import type { ContentRef } from '../../src/network/content-reference';
import type { NetworkQuery } from '../../src/network/query';
import {
  createSchemaV16SystemProvider,
  legacyDerivedId,
} from '../../src/network/schema-v16-system-provider';
import { networkQueryDigest } from '../../src/network/schema-v16-system/identity';
import { aSystem } from '../support/fixtures.test';

const allModesQuery: NetworkQuery = {
  serviceTime: { kind: 'live' },
  modes: { kind: 'all' },
  filters: {},
  bounds: { kind: 'ordinary', west: -116, south: 35, east: -114, north: 37 },
  detailBand: 'district',
};

function latestReference(system: TransitSystem): ContentRef {
  return {
    kind: 'transit-system',
    id: system.id,
    revision: { kind: 'latest' },
  };
}

async function canonicalDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    Uint8Array.from(canonicalValueBytes(value)).buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('schema-v16 system provider query identity', () => {
  it('binds chunk IDs to concrete content and canonical query identity', async () => {
    const privateUse = '\uE000';
    const supplementary = '\u{10000}';
    const system = aSystem({ id: 'chunk-identity', name: 'First revision' });
    const provider = createSchemaV16SystemProvider(system);
    const descriptor = await provider.describe(latestReference(system));
    const query: NetworkQuery = {
      ...allModesQuery,
      modes: { kind: 'only', ids: [supplementary, privateUse] },
      filters: { routes: [supplementary, privateUse] },
    };
    const result = await provider.resolve(descriptor.content, query);
    const canonicalQuery: NetworkQuery = {
      ...allModesQuery,
      modes: { kind: 'only', ids: [privateUse, supplementary] },
      filters: { routes: [privateUse, supplementary] },
    };
    const expectedDigest = await canonicalDigest({
      version: 'network-query-v1',
      content: descriptor.content,
      query: canonicalQuery,
    });

    expect(result.chunks[0].id).toBe(legacyDerivedId('network-chunk', system.id, expectedDigest));
    expect(query.modes).toEqual({ kind: 'only', ids: [supplementary, privateUse] });
    expect(query.filters.routes).toEqual([supplementary, privateUse]);

    const reordered = await provider.resolve(descriptor.content, canonicalQuery);
    expect(reordered.chunks[0].id).toBe(result.chunks[0].id);

    const revisedSystem = { ...system, name: 'Second revision' };
    const revisedProvider = createSchemaV16SystemProvider(revisedSystem);
    const revisedDescriptor = await revisedProvider.describe(latestReference(revisedSystem));
    const revised = await revisedProvider.resolve(revisedDescriptor.content, canonicalQuery);
    expect(revised.chunks[0].id).not.toBe(result.chunks[0].id);
  });

  it('removes pagination state from canonical query identity', async () => {
    const system = aSystem({ id: 'cursor-identity' });
    const provider = createSchemaV16SystemProvider(system);
    const descriptor = await provider.describe(latestReference(system));

    const firstPage = await networkQueryDigest(descriptor.content, allModesQuery);
    const laterPage = await networkQueryDigest(descriptor.content, {
      ...allModesQuery,
      cursor: 'opaque-provider-page',
    });

    expect(laterPage).toEqual(firstPage);
  });
});
