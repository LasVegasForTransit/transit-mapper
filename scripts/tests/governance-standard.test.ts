import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { githubGovernanceDoctor } from '@lasvegasfortransit/web-platform/github';

const root = resolve(import.meta.dirname, '../..');
interface Ruleset {
  name: string;
  rules: { type: string; parameters?: { required_status_checks?: { context: string }[] } }[];
}
const standard = JSON.parse(
  readFileSync(resolve(root, '.lvbt/web-platform/standards/ruleset.json'), 'utf8'),
) as Ruleset;
const repository = 'LasVegasForTransit/transit-mapper';

describe('the adopted organization governance standard', () => {
  it('requires only checks CI reports for pull requests and merge groups', () => {
    const directory = resolve(root, '.github/workflows');
    const reported = new Set(
      readdirSync(directory)
        .filter((file) => /\.ya?ml$/u.test(file))
        .flatMap((file) => {
          const source = readFileSync(resolve(directory, file), 'utf8');
          return ['pull_request', 'merge_group'].every((event) =>
            new RegExp(`^  ${event}:`, 'mu').test(source),
          )
            ? [...source.matchAll(/^ {4}name: (.+)$/gmu)].flatMap(
                (match) => match[1]?.replace(/^['"]|['"]$/gu, '') ?? [],
              )
            : [];
        }),
    );
    const required = standard.rules.find((rule) => rule.type === 'required_status_checks')
      ?.parameters?.required_status_checks;
    expect(required?.length).toBeGreaterThan(0);
    expect(required?.filter((check) => !reported.has(check.context))).toEqual([]);
  });
  it('reports the canonical protections while preserving additional merge queue policy', async () => {
    const actual = {
      ...standard,
      rules: [...standard.rules, { type: 'merge_queue', parameters: { merge_method: 'REBASE' } }],
    };
    const before = JSON.stringify(actual);
    const endpoints: string[] = [];
    const results = await githubGovernanceDoctor({ repository, ruleset: standard }, (endpoint) => {
      endpoints.push(endpoint);
      if (endpoint === `repos/${repository}/rulesets`)
        return Promise.resolve([{ id: 1, name: standard.name }]);
      if (endpoint === `repos/${repository}/rulesets/1`) return Promise.resolve(actual);
      if (endpoint.endsWith('/actions/permissions/workflow'))
        return Promise.resolve({
          default_workflow_permissions: 'read',
          can_approve_pull_request_reviews: true,
        });
      if (endpoint.endsWith('/automated-security-fixes'))
        return Promise.resolve({ enabled: true, paused: false });
      if (endpoint.endsWith('/vulnerability-alerts')) return Promise.resolve(null);
      if (endpoint.endsWith('/actions/permissions'))
        return Promise.resolve({ enabled: true, sha_pinning_required: true });
      return Promise.resolve({
        allow_merge_commit: false,
        allow_squash_merge: false,
        allow_rebase_merge: true,
        security_and_analysis: {
          secret_scanning: { status: 'enabled' },
          secret_scanning_push_protection: { status: 'enabled' },
        },
      });
    });
    expect(results.every((check) => check.status === 'pass')).toBe(true);
    expect(results.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        'merge-methods',
        'ruleset',
        'secret-scanning',
        'actions-policy',
        'workflow-permissions',
        'vulnerability-alerts',
        'security-updates',
      ]),
    );
    expect(JSON.stringify(actual)).toBe(before);
    expect(endpoints.every((endpoint) => endpoint.startsWith(`repos/${repository}`))).toBe(true);
  });
  it('reports unreadable governance as unknown without creating a replacement', async () => {
    const report = await githubGovernanceDoctor({ repository, ruleset: standard }, () =>
      Promise.reject(new Error('permission denied')),
    );
    expect(report.every((check) => check.status === 'unknown')).toBe(true);
  });
});
