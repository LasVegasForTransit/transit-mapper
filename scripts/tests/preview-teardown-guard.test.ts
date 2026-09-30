import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/preview.yml'), 'utf8');

/**
 * The teardown guard, executed as the workflow executes it. The Cloudflare
 * API deletes whatever script name it receives, including the production
 * Worker if a future workflow edit passes the wrong name.
 */
function guardAccepts(name: string): boolean {
  const result = spawnSync(
    '/bin/sh',
    ['-c', `case "$1" in transitmapper-pr-[0-9]*) exit 0 ;; *) exit 1 ;; esac`, 'sh', name],
    { encoding: 'utf8' },
  );
  return result.status === 0;
}

describe('the teardown name guard', () => {
  it('is the guard the workflow runs', () => {
    expect(workflow).toContain('transitmapper-pr-[0-9]*)');
  });

  it.each(['transitmapper-pr-1', 'transitmapper-pr-4213'])('accepts %s', (name) => {
    expect(guardAccepts(name)).toBe(true);
  });

  it.each(['transitmapper', 'transitmapper-preview', 'transitmapper-pr-', ''])(
    'refuses %s',
    (name) => {
      expect(guardAccepts(name)).toBe(false);
    },
  );
});
