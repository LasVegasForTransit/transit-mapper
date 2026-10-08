import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import type { BrowserType } from 'playwright-core';
import { accessCredentials, accessFetch } from './access-auth.js';
import { runWorkerReleaseSmoke, validateWorkerSmokeOrigin } from './worker-release-smoke.js';
import { scopeBrowserAccess } from './release-browser.js';
import { productionEndpoint } from './release-path.js';
import { waitForReleaseIdentity } from './release-identity.js';
import type { ReleaseConfiguration } from './release-config.js';

function smokeOrigin(
  config: ReleaseConfiguration,
  url: string | undefined,
  checks: { publicCheck: boolean; protectedCheck: boolean },
): string {
  if (!url) throw new Error('Pass --url with an HTTPS origin.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash)
    throw new Error('Pass an HTTPS origin without a path.');
  const origin = parsed.origin;
  if (checks.publicCheck && origin !== config.productionUrl)
    throw new Error('Public checks require the configured production origin.');
  if (checks.protectedCheck) validateWorkerSmokeOrigin(origin, config, true);
  return origin;
}

export async function runReleaseSmoke(
  config: ReleaseConfiguration,
  chromium: Pick<BrowserType, 'launch'>,
  args: string[] = process.argv.slice(2),
): Promise<void> {
  if (config.smoke) {
    await runWorkerReleaseSmoke(config, args);
    return;
  }
  const { values } = parseArgs({
    args,
    options: {
      url: { type: 'string' },
      commit: { type: 'string' },
      'release-id': { type: 'string' },
      protected: { type: 'boolean', default: false },
      public: { type: 'boolean', default: false },
      'wait-for-propagation': { type: 'boolean', default: false },
    },
  });
  const origin = smokeOrigin(config, values.url, {
    publicCheck: values.public,
    protectedCheck: values.protected,
  });
  const credentials = values.protected ? accessCredentials(process.env) : undefined;
  if (values.protected) {
    if (!credentials)
      throw new Error('Protected staging verification requires Access credentials.');
    assert.ok(
      [302, 401, 403].includes((await accessFetch(`${origin}/`, origin)).status),
      'Anonymous request reached staging.',
    );
  }
  if (!values.commit || !values['release-id'])
    throw new Error('Pass both --commit and --release-id.');
  await waitForReleaseIdentity(
    origin,
    {
      commit: values.commit,
      releaseId: values['release-id'],
      ...(config.profile ? { app: config.profile } : {}),
    },
    {
      ...(credentials ? { credentials } : {}),
      publicPath: origin === config.productionUrl ? config.publicPath : '/',
      timeoutMs: values['wait-for-propagation'] ? 180_000 : 0,
    },
  );
  await renderReleaseSmoke(chromium, {
    origin,
    endpoint: origin === config.productionUrl ? productionEndpoint(config) : origin,
    credentials,
    protectedOrigin: values.protected,
    releaseId: values['release-id'],
  });
}

async function renderReleaseSmoke(
  chromium: Pick<BrowserType, 'launch'>,
  {
    origin,
    endpoint,
    credentials,
    protectedOrigin,
    releaseId,
  }: {
    origin: string;
    endpoint: string;
    credentials: ReturnType<typeof accessCredentials>;
    protectedOrigin: boolean;
    releaseId: string;
  },
): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await scopeBrowserAccess(context, origin, credentials);
      const page = await context.newPage();
      const response = await page.goto(endpoint, { waitUntil: 'networkidle' });
      assert.equal(response?.status(), 200, 'The app did not render.');
      assert.equal(new URL(page.url()).origin, origin, 'The browser left the configured origin.');
      assert.ok(await page.locator('main').isVisible(), 'The app main content is not visible.');
      if (protectedOrigin) assert.match(response.headers()['x-robots-tag'] ?? '', /noindex/);
      process.stdout.write(`PASS: rendered ${origin}, release ${releaseId}\n`);
    } finally {
      await context.unrouteAll({ behavior: 'wait' });
    }
  } finally {
    await browser.close();
  }
}
