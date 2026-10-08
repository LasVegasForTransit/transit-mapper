import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { prPreviewComment } from '../src/pr-preview-comment.mjs';

test('profile previews have independent sticky markers and visible profile names', () => {
  const map = prPreviewComment('map', 'https://map-pr-42.example.workers.dev');
  const news = prPreviewComment('news', 'https://news-pr-42.example.workers.dev');
  expect(map.marker).toBe('<!-- lvbt-worker-preview:map -->');
  expect(news.marker).toBe('<!-- lvbt-worker-preview:news -->');
  expect(map.body).toContain('Worker candidate (map): https://map-pr-42.example.workers.dev');
  expect(map.body.includes(news.marker)).toBe(false);
  expect(news.body.includes(map.marker)).toBe(false);
});
test('a single unprofiled consumer preserves its existing sticky comment', () => {
  const comment = prPreviewComment('', 'https://app-pr-42.example.workers.dev');
  expect(comment.marker).toBe('<!-- lvbt-worker-preview -->');
  expect(comment.body).toContain('Worker candidate: https://app-pr-42.example.workers.dev');
});
test('unreviewed profile strings cannot forge another comment marker', () => {
  expect(() => prPreviewComment('map -->\n<!-- other', 'https://example.org')).toThrow();
});
test('the shared workflow uses profile markers and trusts default branch cleanup tools on closed unmerged events', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/release-pr-preview.yml', import.meta.url),
    'utf8',
  );
  expect(workflow).toContain(
    "prPreviewComment(process.env.LVBT_RELEASE_APP || '', process.env.PREVIEW_URL)",
  );
  const teardown = workflow.slice(workflow.indexOf('  teardown:'));
  expect(teardown).toContain('ref: ${{ github.event.repository.default_branch }}');
  expect(teardown).not.toContain('ref: ${{ github.sha }}');
  expect(teardown).toContain('"$GITHUB_SHA" --release-id "$GITHUB_RUN_ID"');
});
