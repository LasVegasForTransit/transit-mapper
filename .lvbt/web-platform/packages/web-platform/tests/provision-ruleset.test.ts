import { expect, test } from 'vitest';
import standard from '../../../standards/ruleset.json' with { type: 'json' };
import { reconcileResources } from '../src/provision-reconcile.ts';
import { provisionRepositoryRuleset } from '../src/provision-ruleset.ts';

test('creates and verifies the pinned repository ruleset once', async () => {
  let summary: unknown[] = [];
  let details: unknown = null;
  const writes: { method: string; endpoint: string; body: unknown }[] = [];
  const read = (endpoint: string) =>
    Promise.resolve(endpoint.endsWith('/rulesets') ? summary : details);
  const resource = provisionRepositoryRuleset(
    { repository: 'LasVegasForTransit/labs', ruleset: standard },
    read,
    (method, endpoint, body) => {
      writes.push({ method, endpoint, body });
      summary = [{ id: 42, name: standard.name, target: 'branch', source_type: 'Repository' }];
      details = { id: 42, source_type: 'Repository', ...standard };
      return Promise.resolve();
    },
  );

  expect((await reconcileResources([resource], false)).operations[0]?.status).toBe('planned');
  expect((await reconcileResources([resource], true)).ok).toBe(true);
  expect(writes).toEqual([
    {
      method: 'POST',
      endpoint: 'repos/LasVegasForTransit/labs/rulesets',
      body: standard,
    },
  ]);
  expect((await reconcileResources([resource], true)).changed).toBe(false);
  expect(writes).toHaveLength(1);
});

test('updates the one named repository ruleset and rejects duplicates', async () => {
  const summaries = [{ id: 42, name: standard.name, target: 'branch', source_type: 'Repository' }];
  let details: unknown = { ...standard, rules: [] };
  const writes: { method: string; endpoint: string }[] = [];
  const resource = provisionRepositoryRuleset(
    { repository: 'LasVegasForTransit/labs', ruleset: standard },
    (endpoint) => Promise.resolve(endpoint.endsWith('/rulesets') ? summaries : details),
    (method, endpoint) => {
      writes.push({ method, endpoint });
      details = standard;
      return Promise.resolve();
    },
  );

  expect((await reconcileResources([resource], true)).ok).toBe(true);
  expect(writes).toEqual([
    { method: 'PUT', endpoint: 'repos/LasVegasForTransit/labs/rulesets/42' },
  ]);

  const duplicate = provisionRepositoryRuleset(
    { repository: 'LasVegasForTransit/labs', ruleset: standard },
    () => Promise.resolve([...summaries, { ...summaries[0], id: 43 }]),
    () => Promise.resolve(),
  );
  expect((await reconcileResources([duplicate], true)).ok).toBe(false);
});

test('accepts provider fields added inside managed rule parameters', async () => {
  const details = structuredClone(standard);
  const pullRequestRule = details.rules.find((rule) => rule.type === 'pull_request');
  if (!pullRequestRule?.parameters)
    throw new Error('The standard requires pull request parameters.');
  Object.assign(pullRequestRule.parameters, {
    require_extra_approval_for_unattributed_changes: true,
  });
  const resource = provisionRepositoryRuleset(
    { repository: 'LasVegasForTransit/labs', ruleset: standard },
    (endpoint) =>
      Promise.resolve(
        endpoint.endsWith('/rulesets')
          ? [{ id: 42, name: standard.name, target: 'branch', source_type: 'Repository' }]
          : details,
      ),
    () => Promise.reject(new Error('A matching ruleset must not be rewritten.')),
  );

  expect((await reconcileResources([resource], true)).changed).toBe(false);
});
