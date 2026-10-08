import { expect, test } from 'vitest';
import { productionEndpoint, releaseMarkerPath } from '../src/release-path.js';
import { readReleaseIdentity, waitForReleaseIdentity } from '../src/release-identity.js';

test('nested profile identity uses its exact public marker and preserves the same-origin credential boundary', async () => {
  const identity = { commit: 'a'.repeat(40), releaseId: '123', app: 'funding' };
  const calls: string[] = [];
  const request = (url: string) => {
    calls.push(url);
    return Promise.resolve(Response.json(identity));
  };
  expect(
    productionEndpoint({ productionUrl: 'https://example.org', publicPath: '/funding/' }),
  ).toBe('https://example.org/funding/');
  expect(releaseMarkerPath('/funding/')).toBe('/funding/lvbt-release.json');
  expect(
    await readReleaseIdentity('https://example.org', {
      publicPath: '/funding/',
      app: 'funding',
      request,
    }),
  ).toEqual(identity);
  expect(calls).toEqual(['https://example.org/funding/lvbt-release.json']);
  await expect(
    waitForReleaseIdentity(
      'https://example.org',
      { ...identity, app: 'home' },
      { publicPath: '/funding/', request },
    ),
  ).rejects.toThrow('app');
});
