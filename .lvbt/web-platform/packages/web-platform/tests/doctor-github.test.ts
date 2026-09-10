import { expect, test } from 'vitest';
import { githubDoctor } from '../src/doctor-github.ts';
import standard from '../../../standards/ruleset.json' with { type: 'json' };

const target = {
  repository: 'LasVegasForTransit/labs',
  branch: 'main',
  environment: 'production',
  accountId: 'account',
  zoneId: 'zone',
  preview: {
    environment: 'preview',
    secret: 'CLOUDFLARE_PREVIEW_API_TOKEN',
    enabledVariable: 'CLOUDFLARE_PREVIEWS_ENABLED',
  },
  ruleset: standard,
};
const fixture: Record<string, unknown> = {
  '': { full_name: target.repository, private: false, archived: false, default_branch: 'main' },
  '/rules/branches/main': structuredClone(standard.rules),
  '/environments/production': {
    deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
  },
  '/environments/production/deployment-branch-policies': {
    branch_policies: [{ name: 'main', type: 'branch' }],
  },
  '/environments/production/secrets': { secrets: [{ name: 'CLOUDFLARE_API_TOKEN' }] },
  '/actions/variables': {
    variables: [
      { name: 'CLOUDFLARE_ACCOUNT_ID', value: 'account' },
      { name: 'CLOUDFLARE_ZONE_ID', value: 'zone' },
      { name: 'CLOUDFLARE_PREVIEWS_ENABLED', value: 'true' },
    ],
  },
  '/environments/production/variables': {
    variables: [{ name: 'CLOUDFLARE_WEB_ANALYTICS_TOKEN', value: 'public-analytics-id' }],
  },
  '/environments/preview': { id: 42 },
  '/environments/preview/secrets': { secrets: [{ name: 'CLOUDFLARE_PREVIEW_API_TOKEN' }] },
};

test('checks repository controls and production configuration without reading secret values', async () => {
  const paths: string[] = [];
  const result = await githubDoctor(target, (endpoint) => {
    paths.push(endpoint);
    return Promise.resolve(fixture[endpoint.replace(`repos/${target.repository}`, '')]);
  });
  expect(result.every((check) => check.status === 'pass')).toBe(true);
  expect(paths.every((endpoint) => endpoint.startsWith(`repos/${target.repository}`))).toBe(true);
  expect(JSON.stringify(result)).not.toContain('public-analytics-id');
  expect(result.find((check) => check.id === 'github.preview')?.status).toBe('pass');
  expect(result.find((check) => check.id === 'github.preview-credentials')?.status).toBe('pass');
  expect(result.find((check) => check.id === 'github.preview-enabled')?.status).toBe('pass');
});

test('distinguishes missing credentials from an inaccessible provider', async () => {
  const missing = await githubDoctor(target, (endpoint) =>
    Promise.resolve(
      endpoint.endsWith('/secrets')
        ? { secrets: [] }
        : fixture[endpoint.replace(`repos/${target.repository}`, '')],
    ),
  );
  expect(missing.find((check) => check.id === 'github.credentials')?.status).toBe('fail');
  const denied = await githubDoctor(target, () => Promise.reject(new Error('private token')));
  expect(denied.every((check) => check.status === 'unknown')).toBe(true);
  expect(JSON.stringify(denied)).not.toContain('private token');
});

test('distinguishes missing preview credentials and a disabled preview workflow', async () => {
  const result = await githubDoctor(target, (endpoint) => {
    if (endpoint.endsWith('/environments/preview/secrets')) return Promise.resolve({ secrets: [] });
    if (endpoint.endsWith('/actions/variables'))
      return Promise.resolve({
        variables: (
          fixture['/actions/variables'] as { variables: { name: string; value: string }[] }
        ).variables.filter((variable) => variable.name !== 'CLOUDFLARE_PREVIEWS_ENABLED'),
      });
    return Promise.resolve(fixture[endpoint.replace(`repos/${target.repository}`, '')]);
  });
  expect(result.find((check) => check.id === 'github.preview-credentials')?.status).toBe('fail');
  expect(result.find((check) => check.id === 'github.preview-enabled')?.status).toBe('fail');
});

test('rejects unrestricted production branches and a nonrequired Validate check', async () => {
  const result = await githubDoctor(target, (endpoint) =>
    Promise.resolve(
      endpoint.endsWith('/environments/production')
        ? { deployment_branch_policy: null }
        : endpoint.includes('/rules/branches/')
          ? []
          : fixture[endpoint.replace(`repos/${target.repository}`, '')],
    ),
  );
  expect(result.find((check) => check.id === 'github.production')?.status).toBe('fail');
  expect(result.find((check) => check.id === 'github.rules')?.status).toBe('fail');
});

test('requires the pinned pull-request and linear-history rules', async () => {
  const rules = fixture['/rules/branches/main'] as { type: string; parameters?: unknown }[];
  for (const type of ['pull_request', 'required_linear_history']) {
    const result = await githubDoctor(target, (endpoint) =>
      Promise.resolve(
        endpoint.includes('/rules/branches/')
          ? rules.filter((rule) => rule.type !== type)
          : fixture[endpoint.replace(`repos/${target.repository}`, '')],
      ),
    );
    expect(result.find((check) => check.id === 'github.rules')?.status).toBe('fail');
  }
});
