import { test as base } from '@playwright/test';
import { accessCredentials, scopeBrowserAccess } from '@lasvegasfortransit/web-platform/release';

export { expect } from '@playwright/test';
export const test = base.extend({
  context: async ({ context, baseURL }, use) => {
    if (baseURL)
      await scopeBrowserAccess(context, new URL(baseURL).origin, accessCredentials(process.env));
    try {
      await use(context);
    } finally {
      await context.unrouteAll({ behavior: 'wait' });
    }
  },
});
