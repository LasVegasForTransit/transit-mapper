import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(import.meta.dirname, '../..');
const REPOSITORY_ROOT = resolve(WEB_ROOT, '../..');

function repositorySource(path: string): string {
  return readFileSync(resolve(REPOSITORY_ROOT, path), 'utf8');
}

describe('release performance gates', () => {
  it('keeps the required RTC check name aligned with its terminal pull-request job', () => {
    const workflow = repositorySource('.github/workflows/performance.yml');
    const standards = repositorySource('scripts/bootstrap/standards.ts');
    const checks = [...standards.matchAll(/context: '([^']+)'/g)].map((match) => match[1]);

    expect(checks).toEqual(['Validate', 'RTC responsiveness (desktop)']);
    expect(workflow).toContain('name: RTC responsiveness (desktop)');
    expect(workflow).toContain('pull_request:');
    expect(workflow).not.toMatch(/pull_request:\n(?:.|\n)*?paths:/);
    expect(workflow).toContain('Run the repeated RTC audit');
    expect(workflow).toContain('pnpm perf -- --profile desktop --scenario rtc');
    expect(workflow).toContain('Skip the RTC audit for an unrelated pull request');
    for (const relevantPath of [
      'apps/web',
      'packages/core',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.github/workflows/performance.yml',
      '.github/actions/setup-node-pnpm',
    ]) {
      expect(workflow).toContain(relevantPath);
    }
  });

  it('runs the production smoke phases as separate reusable jobs before Release Please', () => {
    const performance = repositorySource('.github/workflows/performance.yml');
    const deploy = repositorySource('.github/workflows/deploy-production.yml');

    expect(performance).toContain('workflow_call:');
    expect(performance).toContain('name: Functional route smoke (desktop)');
    expect(performance).toContain('name: Onboarding smoke (desktop)');
    expect(performance).toContain('name: Run the release RTC smoke');
    expect(performance).toContain("inputs.scope == 'release'");
    expect(performance).toContain('pnpm perf -- --smoke --profile desktop --scenario rtc');
    expect(performance).toContain('pnpm --filter @transitmapper/web smoke:release');
    expect(performance).toContain('pnpm perf -- --smoke --profile desktop --onboarding');
    expect(deploy).toContain('uses: ./.github/workflows/performance.yml');
    expect(deploy).toContain('needs: [validate, performance]');
    expect(deploy).toContain(
      'gh workflow run performance.yml --repo "$GITHUB_REPOSITORY" --ref "$release_branch"',
    );
    expect(deploy).toContain('pnpm --filter @transitmapper/web perf:live-production --');
    expect(deploy).toContain('--site "$SITE"');
  });
});
