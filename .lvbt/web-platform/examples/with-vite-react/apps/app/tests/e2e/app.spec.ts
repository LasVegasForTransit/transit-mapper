import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from '@lvbt/playwright-config/accessibility';
import { monitorPageHealth } from '@lvbt/playwright-config/page-health';

test('the button counts clicks', async ({ page }) => {
  const health = monitorPageHealth(page);
  await page.goto('/');
  const button = page.getByRole('button');
  await expect(button).toHaveText('Clicked 0 times');
  await button.click();
  await expect(button).toHaveText('Clicked 1 times');
  await expectNoAccessibilityViolations(page);
  health.assertNoErrors();
});
