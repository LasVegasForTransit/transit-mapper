import { expect, test } from 'vitest';
import { readProductionBaseline } from '../src/publication-baseline.js';
const config = {
  productionWorker: 'app',
  productionUrl: 'https://example.org',
  profile: 'home',
  publicPath: '/',
};
const version = '1c4deaba-ee53-4c3f-ba65-176ae596cad5';
const legacy = {
  formatVersion: 1,
  slug: 'home',
  commit: 'a'.repeat(40),
  artifactHash: 'b'.repeat(64),
};

test('first adoption retains authenticated provider version and legacy evidence without inventing a release ID', async () => {
  await Promise.resolve();
  const events: string[] = [];
  const result = await readProductionBaseline(config, version, {
    verifyVersion: async (_, expected) => {
      await Promise.resolve();
      events.push(`version:${expected}`);
    },
    request: async () => {
      await Promise.resolve();
      events.push('marker');
      return Response.json(legacy);
    },
  });
  expect(events).toEqual([`version:${version}`, 'marker']);
  expect(result).toEqual({
    identity: null,
    evidence: { kind: 'provider-version', version, markerStatus: 'legacy', legacyMarker: legacy },
  });
});

test.each([404, 200])(
  'guarded adoption permits an absent or nonmarker page (%s), without storing page contents',
  async (status) => {
    const result = await readProductionBaseline(config, version, {
      verifyVersion: async () => {
        await Promise.resolve();
      },
      request: () => Promise.resolve(new Response('<html>Application</html>', { status })),
    });
    expect(result.identity).toBeNull();
    expect(result.evidence).toMatchObject({
      version,
      markerStatus: status === 404 ? 'missing' : 'nonmarker',
      legacyMarker: null,
    });
  },
);

test.each([301, 302, 401, 403, 429, 500, 503])(
  'guarded adoption still rejects authentication/server errors (%s)',
  async (status) => {
    await expect(
      readProductionBaseline(config, version, {
        verifyVersion: async () => {
          await Promise.resolve();
        },
        request: () => Promise.resolve(new Response('Unavailable', { status })),
      }),
    ).rejects.toThrow();
  },
);

test('changed provider state prevents even the marker request; matching another legacy slug fails closed', async () => {
  await Promise.resolve();
  let requests = 0;
  await expect(
    readProductionBaseline(config, version, {
      verifyVersion: async () => {
        await Promise.resolve();
        throw new Error('changed');
      },
      request: async () => {
        await Promise.resolve();
        requests++;
        return Response.json(legacy);
      },
    }),
  ).rejects.toThrow('changed');
  expect(requests).toBe(0);
  await expect(
    readProductionBaseline(config, version, {
      verifyVersion: async () => {
        await Promise.resolve();
      },
      request: () => Promise.resolve(Response.json({ ...legacy, slug: 'other' })),
    }),
  ).rejects.toThrow(/another app/);
});

test('unguarded adoption cannot reinterpret a legacy marker or missing page as a saved identity', async () => {
  await Promise.resolve();
  await expect(
    readProductionBaseline(config, undefined, {
      request: () => Promise.resolve(Response.json(legacy)),
    }),
  ).rejects.toThrow(/identity/);
  await expect(
    readProductionBaseline(config, undefined, {
      request: () => Promise.resolve(new Response('missing', { status: 404 })),
    }),
  ).rejects.toThrow();
});
