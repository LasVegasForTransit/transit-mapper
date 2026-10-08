import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readReleaseIdentity, waitForReleaseIdentity } from '../src/release-identity.js';
const expected = { commit: 'a'.repeat(40), releaseId: '123' };
const stale = { commit: 'b'.repeat(40), releaseId: '122' };
const origin = 'https://example.test';
function clock() {
  let time = 0;
  return {
    now: () => time,
    sleep: (ms: number) => {
      time += ms;
      return Promise.resolve();
    },
  };
}
test('activation waits for the selected release after stale markers and transient failures', async () => {
  const replies = [
    new Response('unavailable', { status: 503 }),
    Response.json(stale),
    Response.json(expected),
  ];
  let requests = 0;
  await waitForReleaseIdentity(origin, expected, {
    ...clock(),
    timeoutMs: 15000,
    intervalMs: 5000,
    request: (_url, options) => {
      assert.equal(options.redirect, 'manual');
      assert.ok(options.signal);
      requests++;
      const response = replies.shift();
      assert.ok(response);
      return Promise.resolve(response);
    },
  });
  assert.equal(requests, 3);
});
test('candidate verification rejects a stale marker without polling', async () => {
  let requests = 0;
  await assert.rejects(
    waitForReleaseIdentity(origin, expected, {
      request: () => {
        requests++;
        return Promise.resolve(Response.json(stale));
      },
    }),
    /Expected release 123/,
  );
  assert.equal(requests, 1);
});
test('propagation retries a socket failure while reading an HTTP 200 marker body', async () => {
  const interrupted = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new TypeError('socket terminated'));
      },
    }),
  );
  const replies = [interrupted, Response.json(expected)];
  let requests = 0;
  await waitForReleaseIdentity(origin, expected, {
    ...clock(),
    timeoutMs: 10_000,
    request: () => {
      requests++;
      const response = replies.shift();
      assert.ok(response);
      return Promise.resolve(response);
    },
  });
  assert.equal(requests, 2);
});
test('malformed JSON is a permanent marker failure, not propagation', async () => {
  await assert.rejects(
    waitForReleaseIdentity(origin, expected, {
      ...clock(),
      timeoutMs: 180_000,
      request: () => Promise.resolve(new Response('not json')),
    }),
    /invalid identity/,
  );
});
for (const status of [302, 401, 403]) {
  test(`authentication status ${status} fails immediately during propagation`, async () => {
    let requests = 0;
    await assert.rejects(
      waitForReleaseIdentity(origin, expected, {
        ...clock(),
        timeoutMs: 180000,
        request: () => {
          requests++;
          return Promise.resolve(new Response('', { status }));
        },
      }),
      /authentication/i,
    );
    assert.equal(requests, 1);
  });
}
test('propagation deadline reports the last observed release and never activates anything', async () => {
  await assert.rejects(
    waitForReleaseIdentity(origin, expected, {
      ...clock(),
      timeoutMs: 10000,
      intervalMs: 5000,
      request: () => Promise.resolve(Response.json(stale)),
    }),
    /Expected release 123.*observed release 122/,
  );
});
test('reading preview identity scopes credentials and rejects malformed identities', async () => {
  await assert.rejects(
    readReleaseIdentity(origin, {
      credentials: { clientId: 'id', clientSecret: 'secret' },
      request: (url, options) => {
        assert.equal(url, `${origin}/lvbt-release.json`);
        assert.equal(options.headers['CF-Access-Client-Secret'], 'secret');
        return Promise.resolve(Response.json({ ...expected, releaseId: '../123' }));
      },
    }),
    /identity/i,
  );
});
