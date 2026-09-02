import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deployedWorkerName } from '../assert-deployed-worker.js';

/**
 * Pins the two pieces of shell the preview workflow leans on: the shape of
 * wrangler's deploy record, and the guard that decides which Worker teardown
 * is allowed to delete. Both run after a Worker has already been published, so
 * a break in either is discovered at the worst possible moment.
 */

const repositoryRoot = resolve(import.meta.dirname, '../..');
const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/preview.yml'), 'utf8');

/** A real `wrangler deploy --dry-run` output file, captured verbatim. */
const WRANGLER_OUTPUT = [
  '{"type":"wrangler-session","version":1,"wrangler_version":"4.114.0","timestamp":"2026-09-02T06:07:38.000Z"}',
  '{"type":"deploy","version":1,"worker_name":"transitmapper-pr-7","worker_tag":null,"version_id":null,"wrangler_environment":"preview","worker_name_overridden":false,"timestamp":"2026-09-02T06:07:38.177Z"}',
].join('\n');

describe('the deployed Worker assertion', () => {
  it('reads the Worker name out of wrangler deploy output', () => {
    expect(deployedWorkerName(WRANGLER_OUTPUT)).toBe('transitmapper-pr-7');
  });

  it('ignores records that are not deploys', () => {
    expect(deployedWorkerName('{"type":"wrangler-session","version":1}')).toBeNull();
  });

  it('takes the last deploy when one invocation reports several', () => {
    const second = '{"type":"deploy","worker_name":"transitmapper-pr-8"}';
    expect(deployedWorkerName(`${WRANGLER_OUTPUT}\n${second}`)).toBe('transitmapper-pr-8');
  });
});

/** The script as the workflow invokes it, since that is where it can fail. */
function runAssertion(
  ndjson: string,
  expectedName: string,
): { status: number | null; output: string } {
  const file = join(mkdtempSync(join(tmpdir(), 'transitmapper-deploy-output-')), 'output.json');
  writeFileSync(file, ndjson, 'utf8');
  const result = spawnSync(
    'node',
    [
      '--experimental-strip-types',
      resolve(repositoryRoot, 'scripts/assert-deployed-worker.ts'),
      file,
      expectedName,
    ],
    { encoding: 'utf8' },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('the assertion as the workflow runs it', () => {
  it('accepts the deploy it named', () => {
    expect(runAssertion(WRANGLER_OUTPUT, 'transitmapper-pr-7').status).toBe(0);
  });

  it('rejects a deploy that landed on a different Worker', () => {
    const { status, output } = runAssertion(WRANGLER_OUTPUT, 'transitmapper-pr-8');
    expect(status).not.toBe(0);
    expect(output).toMatch(/Deployed Worker is 'transitmapper-pr-7'/u);
  });

  it('rejects output carrying no Worker name, rather than reading it as a mismatch', () => {
    // The field is an undocumented part of wrangler's output. A rename must
    // say so, not report that the wrong Worker was deployed.
    const { status, output } = runAssertion(
      '{"type":"deploy","targets":["x"]}',
      'transitmapper-pr-7',
    );
    expect(status).not.toBe(0);
    expect(output).toMatch(/output format has changed/u);
  });

  it('refuses to run without both arguments', () => {
    const result = spawnSync(
      'node',
      [
        '--experimental-strip-types',
        resolve(repositoryRoot, 'scripts/assert-deployed-worker.ts'),
        'only-one',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/usage:/u);
  });
});

/**
 * The teardown guard, executed as the workflow executes it. `wrangler delete`
 * without `--name` deletes whatever the configuration names, which in
 * apps/worker is the production Worker.
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
