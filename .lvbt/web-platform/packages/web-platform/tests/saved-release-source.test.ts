import assert from 'node:assert/strict';
import { test } from 'vitest';
import { releaseSource } from '../src/release-source.js';

const run = {
  id: 123,
  run_attempt: 1,
  name: 'Deploy staging',
  path: '.github/workflows/deploy-production.yml',
  event: 'push',
  head_branch: 'main',
  head_sha: 'a'.repeat(40),
  status: 'completed',
  conclusion: 'success',
  repository: { full_name: 'LasVegasForTransit/website' },
  head_repository: { full_name: 'LasVegasForTransit/website' },
};
test('promotion selects the immutable successful main staging run', () => {
  assert.deepEqual(releaseSource(run, 'LasVegasForTransit/website', '123'), {
    commit: 'a'.repeat(40),
    releaseId: '123',
  });
});

test('retrying a failed staging job preserves the previously saved release identity', () => {
  assert.deepEqual(releaseSource({ ...run, run_attempt: 2 }, 'LasVegasForTransit/website', '123'), {
    commit: 'a'.repeat(40),
    releaseId: '123',
  });
});
for (const mutation of [
  { event: 'pull_request' },
  { head_branch: 'feature' },
  { status: 'in_progress' },
  { conclusion: 'failure' },
  { path: '.github/workflows/deploy-worker-preview.yml' },
  { name: 'Deploy production' },
  { id: 124 },
  { head_repository: { full_name: 'outsider/website' } },
]) {
  test(`promotion rejects ${JSON.stringify(mutation)}`, () =>
    assert.throws(() =>
      releaseSource({ ...run, ...mutation }, 'LasVegasForTransit/website', '123'),
    ));
}

test('another repository validates its configured staging workflow rather than website defaults', () => {
  assert.deepEqual(
    releaseSource(
      {
        ...run,
        name: 'Deploy app staging',
        path: '.github/workflows/staging.yml',
        head_branch: 'trunk',
        repository: { full_name: 'Example/app' },
        head_repository: { full_name: 'Example/app' },
      },
      'Example/app',
      '123',
      { name: 'Deploy app staging', path: '.github/workflows/staging.yml', branch: 'trunk' },
    ),
    { commit: 'a'.repeat(40), releaseId: '123' },
  );
});
