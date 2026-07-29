import { describe, expect, it } from 'vitest';
import { protectOfflineData } from '../../src/pwa/persistence';

describe('offline data protection', () => {
  it('reports an unavailable persistent-storage API without pretending data is protected', async () => {
    await expect(protectOfflineData({})).resolves.toEqual('unavailable');
  });

  it('reports whether the browser granted the user-requested protection', async () => {
    await expect(protectOfflineData({ storage: { persist: async () => true } })).resolves.toEqual(
      'protected',
    );
    await expect(protectOfflineData({ storage: { persist: async () => false } })).resolves.toEqual(
      'not-granted',
    );
  });
});
