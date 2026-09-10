import { expect, test } from 'vitest';
import { cloudflareDoctor } from '../src/doctor-cloudflare.ts';

const target = {
  accountId: 'account',
  zoneId: 'zone',
  zoneName: 'example.org',
  hostname: 'labs.example.org',
  workers: [
    { slug: 'home', name: 'lvbt-labs-home' },
    { slug: 'map', name: 'lvbt-labs-map' },
  ],
};
const fixtures: Record<string, unknown> = {
  'zones/zone': {
    id: 'zone',
    name: 'example.org',
    account: { id: 'account' },
    status: 'active',
    paused: false,
  },
  'accounts/account/workers/domains?hostname=labs.example.org': [
    { hostname: 'labs.example.org', service: 'lvbt-labs-home', zone_id: 'zone' },
  ],
  'zones/zone/workers/routes': [
    { pattern: 'labs.example.org/*', script: 'lvbt-labs-home' },
    { pattern: 'labs.example.org/map', script: 'lvbt-labs-map' },
    { pattern: 'labs.example.org/map/*', script: 'lvbt-labs-map' },
  ],
  'zones/zone/dns_records?name=labs.example.org': [
    { name: 'labs.example.org', proxied: true, type: 'AAAA' },
  ],
  'accounts/account/workers/scripts': [{ id: 'lvbt-labs-home' }, { id: 'lvbt-labs-map' }],
  'accounts/account/rum/site_info/list': [
    {
      site_token: 'public-id',
      rules: [{ host: 'labs.example.org', inclusive: true, is_paused: false }],
    },
  ],
};
const read = (endpoint: string) => Promise.resolve(fixtures[endpoint]);

test('checks declared Worker names, exact routes, domain, DNS, and analytics', async () => {
  const result = await cloudflareDoctor(target, { get: read, list: read });
  expect(result.every((check) => check.status === 'pass')).toBe(true);
  expect(JSON.stringify(result)).not.toContain('public-id');
});

test('flags route collisions while preserving an unknown analytics result', async () => {
  const reader = (endpoint: string) => {
    if (endpoint.includes('/rum/')) return Promise.reject(new Error('No analytics permission'));
    if (endpoint.endsWith('/routes'))
      return Promise.resolve([{ pattern: 'labs.example.org/map*', script: 'other' }]);
    return read(endpoint);
  };
  const result = await cloudflareDoctor(target, { get: reader, list: reader });
  expect(result.find((check) => check.id === 'cloudflare.routes')?.status).toBe('fail');
  expect(result.find((check) => check.id === 'cloudflare.analytics')?.status).toBe('unknown');
});
