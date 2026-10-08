import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resolveRelease } from '../src/resolve-release.js';
const repository = 'LasVegasForTransit/website';
const identity = { releaseId: '123', commit: 'a'.repeat(40) };
const run = {
  id: 123,
  run_attempt: 1,
  name: 'Deploy staging',
  path: '.github/workflows/deploy-production.yml',
  event: 'push',
  head_branch: 'main',
  head_sha: identity.commit,
  status: 'completed',
  conclusion: 'success',
  repository: { full_name: repository },
  head_repository: { full_name: repository },
};
const artifacts = { artifacts: [{ name: 'website-release-123', expired: false }] };
test('default promotion pins the actual preview marker instead of newest main run', async () => {
  let markerReads = 0;
  const selected = await resolveRelease(repository, undefined, {
    previewIdentity: () => {
      markerReads++;
      return Promise.resolve(identity);
    },
    getRun: (id) => {
      assert.equal(id, '123');
      return Promise.resolve(run);
    },
    getArtifacts: (id) => {
      assert.equal(id, '123');
      return Promise.resolve(artifacts);
    },
  });
  assert.deepEqual(selected, identity);
  assert.equal(markerReads, 1);
});
test('explicit reviewed release works without reading protected preview', async () => {
  assert.deepEqual(
    await resolveRelease(repository, '123', {
      previewIdentity: () => {
        throw new Error('Must not need local Access');
      },
      getRun: () => Promise.resolve(run),
      getArtifacts: () => Promise.resolve(artifacts),
    }),
    identity,
  );
});
test('preview selection rejects marker/run SHA mismatch and missing or expired artifacts', async () => {
  for (const mutation of [
    { run: { ...run, head_sha: 'b'.repeat(40) }, artifacts },
    { run, artifacts: { artifacts: [] } },
    { run, artifacts: { artifacts: [{ name: 'website-release-123', expired: true }] } },
  ])
    await assert.rejects(
      resolveRelease(repository, undefined, {
        previewIdentity: () => Promise.resolve(identity),
        getRun: () => Promise.resolve(mutation.run),
        getArtifacts: () => Promise.resolve(mutation.artifacts),
      }),
    );
});
test('an activated preview waits for its own staging run to finish, without changing selection', async () => {
  let requests = 0;
  assert.deepEqual(
    await resolveRelease(repository, undefined, {
      previewIdentity: () => Promise.resolve(identity),
      getRun: () =>
        Promise.resolve(
          requests++ === 0 ? { ...run, status: 'in_progress', conclusion: null } : run,
        ),
      getArtifacts: () => Promise.resolve(artifacts),
      sleep: () => {
        return Promise.resolve();
      },
    }),
    identity,
  );
  assert.equal(requests, 2);
});

test('a configured app resolves its own retained artifact without accepting website artifacts', async () => {
  const ownRun = {
    ...run,
    repository: { full_name: 'Example/app' },
    head_repository: { full_name: 'Example/app' },
  };
  const reader = {
    previewIdentity: () => Promise.resolve(identity),
    getRun: () => Promise.resolve(ownRun),
    getArtifacts: () =>
      Promise.resolve({ artifacts: [{ name: 'app-release-123', expired: false }] }),
  };
  assert.deepEqual(
    await resolveRelease('Example/app', undefined, reader, { artifactPrefix: 'app-release' }),
    identity,
  );
  await assert.rejects(
    resolveRelease(
      'Example/app',
      undefined,
      { ...reader, getArtifacts: () => Promise.resolve(artifacts) },
      { artifactPrefix: 'app-release' },
    ),
    /missing or expired/,
  );
});
