import { describe, expect, it } from 'vitest';
import { parseAdaptiveAssetManifest } from '../../src/pwa/adaptive-cache-contract';

const valid = {
  schemaVersion: 1,
  buildId: 'v1.2.3',
  assets: [
    { url: '/assets/dialog.js', bytes: 4_000 },
    { url: '/icons/app-icon.svg', bytes: 6_000 },
  ],
};

describe('adaptive asset manifest contract', () => {
  it('accepts the exact sorted versioned payload', () => {
    expect(parseAdaptiveAssetManifest(valid)).toEqual(valid);
  });

  it.each([
    { ...valid, schemaVersion: 2 },
    { ...valid, trackingId: 'nope' },
    { ...valid, assets: [{ url: 'https://elsewhere.test/a.js', bytes: 1 }] },
    { ...valid, assets: [{ url: '/../secret', bytes: 1 }] },
    { ...valid, assets: [{ url: '/assets/a.js?new=1', bytes: 1 }] },
    { ...valid, assets: [{ url: '/assets/a.js', bytes: -1 }] },
    { ...valid, assets: [{ url: '/assets/a.js', bytes: 1, integrity: 'extra' }] },
    {
      ...valid,
      assets: [
        { url: '/assets/z.js', bytes: 1 },
        { url: '/assets/a.js', bytes: 1 },
      ],
    },
    {
      ...valid,
      assets: [
        { url: '/assets/a.js', bytes: 1 },
        { url: '/assets/a.js', bytes: 1 },
      ],
    },
  ])('rejects an unsafe or ambiguous payload', (value) => {
    expect(() => parseAdaptiveAssetManifest(value)).toThrow('adaptive asset manifest');
  });
});
