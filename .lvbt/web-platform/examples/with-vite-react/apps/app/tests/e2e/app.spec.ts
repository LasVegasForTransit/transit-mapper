import { expect, test } from '@playwright/test';
import { expectNoAccessibilityViolations } from '@lvbt/playwright-config/accessibility';

test('the button counts clicks', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button');
  await expect(button).toHaveText('Clicked 0 times');
  await button.click();
  await expect(button).toHaveText('Clicked 1 times');
  await expectNoAccessibilityViolations(page);
});
