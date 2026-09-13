import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from '@lvbt/playwright-config/accessibility';
import { monitorPageHealth } from '@lvbt/playwright-config/page-health';

test('the home page has one main heading', async ({ page }) => {
  const health = monitorPageHealth(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('LVBT site');
  await expectNoAccessibilityViolations(page);
  health.assertNoErrors();
});

test('unknown paths get the 404 page', async ({ page }) => {
  const health = monitorPageHealth(page);
  const response = await page.goto('/nowhere');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  health.assertNoErrors();
});
