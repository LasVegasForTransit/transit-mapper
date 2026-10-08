import type { BrowserContext, Route, Request } from 'playwright-core';
import { expect, test } from 'vitest';
import { scopeBrowserAccess } from '../src/release-browser.js';

test('a redirected browser request to another origin cannot carry the Access service secret', async () => {
  let handle: ((route: Route, request: Request) => unknown) | undefined;
  const context = {
    route: (_pattern: unknown, handler: (route: Route, request: Request) => unknown) => {
      handle = handler;
      return Promise.resolve({
        dispose: () => Promise.resolve(),
        [Symbol.dispose]() {},
        [Symbol.asyncDispose]: () => Promise.resolve(),
      });
    },
  } as Pick<BrowserContext, 'route'>;
  await scopeBrowserAccess(context, 'https://preview.example.org', {
    clientId: 'test-id',
    clientSecret: 'test-secret',
  });
  const sent: unknown[] = [];
  for (const url of ['https://preview.example.org/', 'https://other.example/redirect']) {
    const request = {
      url: () => url,
      headers: () => ({ Accept: 'text/html' }),
    } as unknown as Request;
    const route = {
      request: () => request,
      continue: () => {
        sent.push({ url, authenticated: false });
        return Promise.resolve();
      },
      fetch: (options: unknown) => {
        sent.push({ url, options });
        return Promise.resolve({});
      },
      fulfill: () => Promise.resolve(),
    } as unknown as Route;
    await handle?.(route, request);
  }
  expect(sent).toEqual([
    {
      url: 'https://preview.example.org/',
      options: {
        headers: {
          Accept: 'text/html',
          'CF-Access-Client-Id': 'test-id',
          'CF-Access-Client-Secret': 'test-secret',
        },
        maxRedirects: 0,
      },
    },
    { url: 'https://other.example/redirect', authenticated: false },
  ]);
});
