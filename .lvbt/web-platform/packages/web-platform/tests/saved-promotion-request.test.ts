import assert from 'node:assert/strict';
import { test } from 'vitest';
import { promotionRequest } from '../src/promotion-request.js';
const matching = {
  id: 456,
  display_title: 'Promote website: request-1',
  event: 'workflow_dispatch',
  head_branch: 'main',
  path: '.github/workflows/deploy-worker-candidate.yml',
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
  html_url: 'https://github.com/LasVegasForTransit/website/actions/runs/456',
};
test('a lost dispatch response reconciles the exact request without dispatching twice', async () => {
  let dispatches = 0;
  const result = await promotionRequest('request-1', undefined, {
    dispatch: () => {
      dispatches++;
      throw new Error('connection lost');
    },
    listRuns: () =>
      Promise.resolve({
        workflow_runs: [
          { ...matching, id: 455, display_title: 'Promote website: someone-else' },
          matching,
        ],
      }),
    getRun: (id) => {
      assert.equal(id, 456);
      return Promise.resolve(matching);
    },
    sleep: () => {
      return Promise.resolve();
    },
  });
  assert.equal(result.id, 456);
  assert.equal(dispatches, 1);
});
test('an unconfirmed dispatch stops with a reconciliation ID and never retries publication', async () => {
  let time = 0;
  let dispatches = 0;
  await assert.rejects(
    promotionRequest('request-1', undefined, {
      dispatch: () => {
        dispatches++;
        throw new Error('connection lost');
      },
      listRuns: () => Promise.resolve({ workflow_runs: [] }),
      getRun: () => Promise.resolve(matching),
      now: () => time,
      sleep: (ms) => {
        time += ms;
        return Promise.resolve();
      },
      discoveryTimeoutMs: 10000,
    }),
    /unconfirmed.*request-1.*Do not dispatch again/i,
  );
  assert.equal(dispatches, 1);
});
test('an explicit release is passed once and a failed run is returned for receipt reconciliation', async () => {
  const result = await promotionRequest('request-1', '123', {
    dispatch: (id, runId) => {
      assert.equal(id, 'request-1');
      assert.equal(runId, '123');
      return Promise.resolve();
    },
    listRuns: () => Promise.resolve({ workflow_runs: [matching] }),
    getRun: () => Promise.resolve({ ...matching, conclusion: 'failure' }),
  });
  assert.equal(result.conclusion, 'failure');
});
test('wrong branch and workflow cannot satisfy the correlation ID', async () => {
  let time = 0;
  await assert.rejects(
    promotionRequest('request-1', undefined, {
      dispatch: () => {
        return Promise.resolve();
      },
      listRuns: () =>
        Promise.resolve({
          workflow_runs: [
            { ...matching, head_branch: 'feature' },
            { ...matching, path: 'other.yml' },
          ],
        }),
      getRun: () => Promise.resolve(matching),
      now: () => time,
      sleep: (ms) => {
        time += ms;
        return Promise.resolve();
      },
      discoveryTimeoutMs: 5000,
    }),
    /unconfirmed/i,
  );
});
test('transient GitHub reads retry while keeping the one dispatched request', async () => {
  let lists = 0;
  let reads = 0;
  let dispatches = 0;
  const result = await promotionRequest('request-1', undefined, {
    dispatch: () => {
      dispatches++;
      return Promise.resolve();
    },
    listRuns: () =>
      lists++ === 0
        ? Promise.reject(new Error('connection lost'))
        : Promise.resolve({ workflow_runs: [matching] }),
    getRun: () =>
      reads++ === 0 ? Promise.reject(new Error('connection lost')) : Promise.resolve(matching),
    sleep: () => Promise.resolve(),
  });
  assert.equal(result.id, 456);
  assert.equal(dispatches, 1);
  assert.equal(lists, 2);
  assert.equal(reads, 2);
});
test('unrecoverable GitHub tracking errors retain the request ID and prohibit redispatch', async () => {
  await assert.rejects(
    promotionRequest('request-1', undefined, {
      dispatch: () => Promise.resolve(),
      listRuns: () => Promise.reject(new Error('connection lost')),
      getRun: () => Promise.resolve(matching),
      sleep: () => Promise.resolve(),
    }),
    /request-1.*Do not dispatch again/,
  );
});

test('request tracking follows the configured app workflow and rejects unrelated website runs', async () => {
  const appRun = {
    ...matching,
    display_title: 'Promote app: request-1',
    path: '.github/workflows/promote.yml',
    head_branch: 'trunk',
  };
  const result = await promotionRequest('request-1', undefined, {
    workflow: {
      titlePrefix: 'Promote app',
      path: '.github/workflows/promote.yml',
      branch: 'trunk',
    },
    dispatch: () => Promise.resolve(),
    listRuns: () => Promise.resolve({ workflow_runs: [matching, appRun] }),
    getRun: () => Promise.resolve(appRun),
    discoveryTimeoutMs: 0,
  });
  assert.equal(result.display_title, 'Promote app: request-1');
});
