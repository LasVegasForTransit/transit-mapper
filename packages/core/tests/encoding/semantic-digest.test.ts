import { describe, expect, it } from 'vitest';
import { semanticDigest } from '../../src/encoding/semantic-digest';

describe('semantic content digests', () => {
  it('give reordered object fields the same identity', async () => {
    const first = await semanticDigest({
      route: { id: 'red-line', modes: ['subway', 'bus'] },
      source: 'agency-feed',
    });
    const reordered = await semanticDigest({
      source: 'agency-feed',
      route: { modes: ['subway', 'bus'], id: 'red-line' },
    });

    expect(reordered).toEqual(first);
  });

  it('treats an omitted optional object field as absent content', async () => {
    const withUndefined = await semanticDigest({ id: 'red-line', label: undefined });
    const absent = await semanticDigest({ id: 'red-line' });

    expect(withUndefined).toEqual(absent);
  });

  it('rejects array holes instead of hashing a repaired value', async () => {
    await expect(semanticDigest(['red-line', undefined])).rejects.toThrow('value[1] is undefined.');
  });
});
