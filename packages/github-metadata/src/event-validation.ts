import { type ValidationResult, validateMetadata } from './validation.js';

interface GitHubActor {
  login?: unknown;
}

interface GitHubPullRequestHead {
  ref?: unknown;
}

interface GitHubPullRequest {
  title?: unknown;
  body?: unknown;
  draft?: unknown;
  head?: GitHubPullRequestHead;
}

interface GitHubIssue {
  title?: unknown;
  body?: unknown;
}

interface GitHubEvent {
  sender?: GitHubActor;
  pull_request?: GitHubPullRequest;
  issue?: GitHubIssue;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function validateGitHubEvent(event: GitHubEvent): ValidationResult {
  if (event.pull_request) {
    return validateMetadata({
      kind: 'pull-request',
      title: stringValue(event.pull_request.title),
      body: stringValue(event.pull_request.body),
      draft: event.pull_request.draft === true,
      actor: stringValue(event.sender?.login),
      headBranch: stringValue(event.pull_request.head?.ref),
    });
  }
  if (event.issue) {
    return validateMetadata({
      kind: 'issue',
      title: stringValue(event.issue.title),
      body: stringValue(event.issue.body),
    });
  }
  return {
    valid: false,
    errors: [
      {
        code: 'unsupported_event',
        field: 'event',
        message: 'The event contains neither an issue nor a pull request.',
      },
    ],
  };
}
