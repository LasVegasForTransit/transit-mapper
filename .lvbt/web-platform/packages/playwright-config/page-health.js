/**
 * Record browser failures during a Playwright test. Start monitoring before
 * navigation, then assert after the page's expected interactions finish.
 *
 * @param {import('@playwright/test').Page} page
 */
export function monitorPageHealth(page) {
  const errors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    errors.push(`page: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    errors.push(
      `request: ${request.method()} ${request.url()} (${failure?.errorText ?? 'unknown failure'})`,
    );
  });

  return {
    get errors() {
      return [...errors];
    },
    assertNoErrors() {
      if (errors.length > 0) throw new Error(`Browser health failures:\n\n${errors.join('\n')}`);
    },
  };
}
