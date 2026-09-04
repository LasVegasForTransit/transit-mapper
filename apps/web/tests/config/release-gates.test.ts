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
  });

  it('measures every package the map is drawn by, not only the two it started with', () => {
    // The renderer used to live inside apps/web. Extracting it took the render
    // pipeline out of the gates' reach without changing a line of this list,
    // and main drifted to a 16.5 s map paint behind commits nothing measured.
    // Naming the packages here means that silent removal fails a test.
    const relevance = repositorySource('.github/actions/perf-relevance/action.yml');

    for (const relevantPath of [
      'apps/web',
      'packages/core',
      'packages/renderer',
      'packages/map',
      'packages/views',
      'packages/workspace',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.github/workflows/performance.yml',
      '.github/actions/perf-relevance',
      '.github/actions/setup-node-pnpm',
    ]) {
      expect(relevance).toContain(relevantPath);
    }
  });

  it('runs the release smokes on a pull request that touches those packages', () => {
    // Twenty-six commits reached main between one green deploy and the next
    // red one because these two jobs only ran after the merge. A regression
    // they would have caught has to fail before it lands, not after.
    const workflow = repositorySource('.github/workflows/performance.yml');
    const smokeJobs = workflow.slice(
      workflow.indexOf('  functional-routes:'),
      workflow.indexOf('  audit:'),
    );

    expect(smokeJobs).not.toContain("github.event_name != 'pull_request'");
    expect(smokeJobs.match(/uses: \.\/\.github\/actions\/perf-relevance/g)).toHaveLength(2);
    expect(smokeJobs.match(/Skip the smoke for an unrelated pull request/g)).toHaveLength(2);
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
    // The post-deploy checks live in a composite action shared with the pull
    // request preview deploy, so assert the release still runs them and that
    // the action still holds the browser walkthrough.
    expect(deploy).toContain('uses: ./.github/actions/verify-deployed-site');
    const verify = repositorySource('.github/actions/verify-deployed-site/action.yml');
    expect(verify).toContain('pnpm --filter @transitmapper/web perf:live-production --');
    expect(verify).toContain('pnpm --filter @transitmapper/web smoke:deployed --');
    expect(verify).toContain('--site "$SITE"');
  });
});
