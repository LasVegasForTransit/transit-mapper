import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderIssueBody, renderPullRequestBody, validateMetadata } from '../src/validation.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const MARKER = /<!--\s*transitmapper:[\s\S]*?-->/g;

function withoutFrontmatter(source: string): string {
  return source.replace(/^---\n[\s\S]*?\n---\n/, '');
}

describe('repository contribution templates', () => {
  it.each([
    ['bug', '.github/ISSUE_TEMPLATE/bug_report.md', ['reproduction', 'expected', 'actual']],
    ['idea', '.github/ISSUE_TEMPLATE/feature_request.md', ['goal', 'current-blocker']],
  ] as const)(
    'keeps the %s issue template on the canonical marker contract',
    async (template, path, fields) => {
      const source = withoutFrontmatter(await readFile(resolve(ROOT, path), 'utf8'));
      const canonical = renderIssueBody({ template, sections: {} });
      const result = validateMetadata({
        kind: 'issue',
        title: 'A specific template title',
        body: source,
      });

      expect(source.match(MARKER)).toEqual(canonical.match(MARKER));
      expect(result.errors.map((error) => error.field)).toEqual(fields);
      expect(source.replace(/<!--[\s\S]*?-->/g, '').trim()).toBe('');
    },
  );

  it('keeps the pull request template on the canonical marker contract', async () => {
    const source = await readFile(resolve(ROOT, '.github/pull_request_template.md'), 'utf8');
    const canonical = renderPullRequestBody({ sections: {} });
    const result = validateMetadata({
      kind: 'pull-request',
      title: 'fix: use the canonical contribution template',
      body: source,
    });

    expect(source.match(MARKER)).toEqual(canonical.match(MARKER));
    expect(result.errors.map((error) => error.field)).toEqual([
      'summary',
      'reason',
      'verification',
    ]);
    expect(source.replace(/<!--[\s\S]*?-->/g, '').trim()).toBe('');
  });
});

describe('repository contribution workflows', () => {
  it('keeps policy failure output parseable before replacing the pending status', async () => {
    const workflow = await readFile(
      resolve(ROOT, '.github/workflows/contribution-metadata.yml'),
      'utf8',
    );

    expect(workflow).toContain('pnpm --silent github:validate --event "$GITHUB_EVENT_PATH" --json');
  });
});
