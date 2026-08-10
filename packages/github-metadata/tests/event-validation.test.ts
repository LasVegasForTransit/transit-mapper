import { describe, expect, it } from 'vitest';

import { validateGitHubEvent } from '../src/event-validation.js';
import { renderPullRequestBody } from '../src/validation.js';

const body = renderPullRequestBody({
  sections: {
    summary: 'Update the dependency while preserving the current application behavior.',
    reason: 'The maintained release includes security and compatibility corrections.',
    verification: 'Ran pnpm check against the updated dependency graph and production build.',
    followups: '',
  },
});

interface PullRequestEventOptions {
  actor?: string;
  branch?: string;
  body?: string;
  draft?: boolean;
  action?: string;
}

function pullRequestEvent(options: PullRequestEventOptions = {}): Record<string, unknown> {
  return {
    action: options.action ?? 'opened',
    sender: { login: options.actor ?? 'maintainer' },
    pull_request: {
      title: 'chore(deps): update dependencies',
      body: options.body ?? body,
      draft: options.draft ?? false,
      head: {
        ref: options.branch ?? 'codex/update-dependencies',
        sha: '1234567890abcdef',
      },
    },
  };
}

describe('GitHub event validation', () => {
  it('defers body validation for a draft and validates it when ready for review', () => {
    const draft = validateGitHubEvent(
      pullRequestEvent({ draft: true, body: '', action: 'synchronize' }),
    );
    const ready = validateGitHubEvent(
      pullRequestEvent({ draft: false, body: '', action: 'ready_for_review' }),
    );

    expect(draft).toEqual({ valid: true, errors: [] });
    expect(ready.valid).toBe(false);
    expect(ready.errors.some((error) => error.field === 'body')).toBe(true);
  });

  it.each([
    ['github-actions[bot]', 'release-please--branches--main--components--TransitMapper'],
    ['dependabot[bot]', 'dependabot/npm_and_yarn/vite-8.0.0'],
    ['renovate[bot]', 'renovate/vitest-4.x'],
  ])('exempts body markers for trusted %s pull requests', (actor, branch) => {
    expect(validateGitHubEvent(pullRequestEvent({ actor, branch, body: '' }))).toEqual({
      valid: true,
      errors: [],
    });
  });

  it.each([
    ['github-actions[bot]', 'codex/release-please-lookalike'],
    ['maintainer', 'release-please--branches--main--components--TransitMapper'],
    ['dependabot[bot]', 'codex/dependabot-lookalike'],
    ['maintainer', 'dependabot/npm_and_yarn/vite-8.0.0'],
    ['renovate[bot]', 'codex/renovate-lookalike'],
    ['maintainer', 'renovate/vitest-4.x'],
    ['github-actions', 'release-please--branches--main--components--TransitMapper'],
  ])('does not exempt an actor or branch near-match (%s on %s)', (actor, branch) => {
    expect(validateGitHubEvent(pullRequestEvent({ actor, branch, body: '' })).valid).toBe(false);
  });

  it('still validates the title of exempt automation', () => {
    const event = pullRequestEvent({
      actor: 'dependabot[bot]',
      branch: 'dependabot/npm_and_yarn/vite-8.0.0',
      body: '',
    });
    const pullRequest = event.pull_request as Record<string, unknown>;
    pullRequest.title = 'Update dependencies';

    const result = validateGitHubEvent(event);

    expect(result.errors.some((error) => error.code === 'invalid_title_format')).toBe(true);
  });

  it('validates the edited body against the unchanged head SHA', () => {
    const invalid = pullRequestEvent({ body: '' });
    const corrected = pullRequestEvent({ body });

    expect(validateGitHubEvent(invalid).valid).toBe(false);
    expect(validateGitHubEvent(corrected).valid).toBe(true);
    expect((invalid.pull_request as { head: { sha: string } }).head.sha).toBe(
      (corrected.pull_request as { head: { sha: string } }).head.sha,
    );
  });
});
