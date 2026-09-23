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
    {
      hostname: 'labs.example.org',
      service: 'lvbt-labs-home',
      zone_id: 'zone',
      cert_id: 'issued-certificate',
    },
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
  'accounts/account/workers/scripts/lvbt-labs-home/subdomain': {
    enabled: false,
    previews_enabled: true,
  },
  'accounts/account/workers/scripts/lvbt-labs-map/subdomain': {
    enabled: false,
    previews_enabled: true,
  },
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

test('recognizes DNS managed by a Worker custom domain without DNS-record access', async () => {
  const reader = (endpoint: string) => {
    if (endpoint.includes('/dns_records'))
      return Promise.reject(new Error('DNS-record listing unavailable'));
    return read(endpoint);
  };

  const result = await cloudflareDoctor(target, { get: reader, list: reader });
  expect(result.find((check) => check.id === 'cloudflare.dns')?.status).toBe('pass');
});

test('rejects a Worker custom domain without an issued certificate', async () => {
  const reader = (endpoint: string) => {
    if (endpoint.includes('/workers/domains'))
      return Promise.resolve([
        { hostname: target.hostname, service: 'lvbt-labs-home', zone_id: target.zoneId },
      ]);
    return read(endpoint);
  };

  const result = await cloudflareDoctor(target, { get: reader, list: reader });
  expect(result.find((check) => check.id === 'cloudflare.domain')?.status).toBe('pass');
  expect(result.find((check) => check.id === 'cloudflare.dns')?.status).toBe('fail');
});

test('accepts one hostname-created analytics site when rules are omitted', async () => {
  const reader = (endpoint: string) => {
    if (endpoint.includes('/rum/'))
      return Promise.resolve([{ host: target.hostname, site_token: 'public-id' }]);
    return read(endpoint);
  };

  const result = await cloudflareDoctor(target, { get: reader, list: reader });
  expect(result.find((check) => check.id === 'cloudflare.analytics')?.status).toBe('pass');
});

test('rejects multiple active analytics sites for the hostname', async () => {
  const reader = (endpoint: string) => {
    if (endpoint.includes('/rum/'))
      return Promise.resolve([
        { host: target.hostname, site_token: 'hostname-site' },
        {
          site_token: 'rules-site',
          rules: [{ host: target.hostname, inclusive: true, is_paused: false }],
        },
      ]);
    return read(endpoint);
  };

  const result = await cloudflareDoctor(target, { get: reader, list: reader });
  expect(result.find((check) => check.id === 'cloudflare.analytics')?.status).toBe('fail');
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

test('fails when any published Worker has version previews disabled', async () => {
  const reader = (endpoint: string) => {
    if (endpoint.endsWith('lvbt-labs-map/subdomain'))
      return Promise.resolve({ enabled: false, previews_enabled: false });
    return read(endpoint);
  };

  const result = await cloudflareDoctor(target, { get: reader, list: reader });
  expect(result.find((check) => check.id === 'cloudflare.worker-previews')?.status).toBe('fail');
});

test('verifies an external Worker route without requiring version previews', async () => {
  const external = {
    ...target,
    workers: [
      ...target.workers,
      { slug: 'transit-mapper', name: 'transitmapper', previewRequired: false },
    ],
  };
  const reader = (endpoint: string) => {
    if (endpoint.endsWith('/workers/routes'))
      return Promise.resolve([
        ...(fixtures['zones/zone/workers/routes'] as object[]),
        { pattern: 'labs.example.org/transit-mapper', script: 'transitmapper' },
        { pattern: 'labs.example.org/transit-mapper/*', script: 'transitmapper' },
      ]);
    if (endpoint.endsWith('/workers/scripts'))
      return Promise.resolve([
        ...(fixtures['accounts/account/workers/scripts'] as object[]),
        { id: 'transitmapper' },
      ]);
    if (endpoint.endsWith('transitmapper/subdomain'))
      return Promise.resolve({ enabled: false, previews_enabled: false });
    return read(endpoint);
  };

  const result = await cloudflareDoctor(external, { get: reader, list: reader });
  expect(result.find((check) => check.id === 'cloudflare.routes')?.status).toBe('pass');
  expect(result.find((check) => check.id === 'cloudflare.workers')?.status).toBe('pass');
  expect(result.find((check) => check.id === 'cloudflare.worker-previews')?.status).toBe('pass');
});
