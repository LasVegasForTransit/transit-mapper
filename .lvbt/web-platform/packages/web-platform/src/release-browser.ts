import type { BrowserContext } from 'playwright-core';
import { accessHeaders, type AccessCredentials } from './access-auth.js';

export async function scopeBrowserAccess(
  context: Pick<BrowserContext, 'route'>,
  origin: string,
  credentials?: AccessCredentials,
): Promise<void> {
  if (!credentials) return;
  await context.route('**/*', async (route) => {
    const headers = accessHeaders(route.request().url(), origin, credentials);
    if (Object.keys(headers).length === 0) {
      await route.continue();
      return;
    }
    const response = await route.fetch({
      headers: { ...route.request().headers(), ...headers },
      maxRedirects: 0,
    });
    await route.fulfill({ response });
  });
}
