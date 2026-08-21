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
    const check = standards.match(/context: '([^']+)'/);

    expect(check?.[1]).toBe('RTC responsiveness (desktop)');
    expect(workflow).toContain('name: RTC responsiveness (desktop)');
    expect(workflow).toContain('pull_request:');
    expect(workflow).not.toMatch(/pull_request:\n(?:.|\n)*?paths:/);
    expect(workflow).toContain('Run the RTC smoke when this pull request changes web or core code');
    expect(workflow).toContain('Skip the RTC smoke for an unrelated pull request');
  });

  it('runs the production smoke phases as separate reusable jobs before Release Please', () => {
    const performance = repositorySource('.github/workflows/performance.yml');
    const deploy = repositorySource('.github/workflows/deploy-production.yml');

    expect(performance).toContain('workflow_call:');
    expect(performance).toContain('name: Public first-session smoke (desktop)');
    expect(performance).toContain('name: Onboarding smoke (desktop)');
    expect(performance).toContain('pnpm perf -- --smoke --profile desktop --scenario rtc');
    expect(performance).toContain('pnpm perf -- --smoke --profile desktop --first-session');
    expect(performance).toContain('pnpm perf -- --smoke --profile desktop --onboarding');
    expect(deploy).toContain('uses: ./.github/workflows/performance.yml');
    expect(deploy).toContain('needs: [validate, performance]');
    expect(deploy).toContain(
      'gh workflow run performance.yml --repo "$GITHUB_REPOSITORY" --ref "$release_branch"',
    );
  });
});
