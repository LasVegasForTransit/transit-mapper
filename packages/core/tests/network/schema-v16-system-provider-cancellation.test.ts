import { describe, expect, it } from 'vitest';
import type { NetworkQuery } from '../../src/network/query';
import { createSchemaV16SystemProvider } from '../../src/network/schema-v16-system-provider';
import { aSystem } from '../support/fixtures.test';

const query: NetworkQuery = {
  serviceTime: { kind: 'live' },
  modes: { kind: 'all' },
  filters: {},
  bounds: { kind: 'ordinary', west: -1, south: -1, east: 1, north: 1 },
  detailBand: 'district',
};

describe('schema-v16 system provider cancellation', () => {
  it('stops a superseded query between bounded projection stages', async () => {
    const controller = new AbortController();
    let projectionStarted = false;
    const system = aSystem();
    const provider = createSchemaV16SystemProvider(system, {
      yieldControl: () => {
        if (projectionStarted) controller.abort();
        projectionStarted = true;
        return Promise.resolve();
      },
    });
    const descriptor = await provider.describe({
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'latest' },
    });

    await expect(
      provider.resolve(descriptor.content, query, { signal: controller.signal }),
    ).rejects.toThrow(/aborted/i);
    expect(projectionStarted).toBe(true);
  });
});
