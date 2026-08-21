import { generatePerfFixture } from '../../src/perf/fixtures';
import { createPerfProtocol } from '../../src/perf/scenarios';
import { chromium, type Browser } from 'playwright-core';
import { closeContext, seedIndexedDbFixture } from './browser';
import { onboardingJourneyViolations } from './onboarding-journey';
import { capturePlaywrightOnboardingJourney } from './playwright-onboarding';

function siteFromArgs(args: readonly string[]): string {
  const index = args.indexOf('--site');
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error('--site requires the deployed application URL.');
  const site = new URL(value);
  if (site.protocol !== 'https:' && site.protocol !== 'http:') {
    throw new Error('--site must use HTTP or HTTPS.');
  }
  return site.href.replace(/\/$/u, '');
}

async function exerciseRtcEditor(browser: Browser, site: string): Promise<void> {
  const fixture = generatePerfFixture('rtc');
  const context = await browser.newContext({
    viewport: { width: 1_440, height: 900 },
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  try {
    await context.route('https://tiles.openfreemap.org/styles/**', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      }),
    );
    await page.goto(`${site}/favicon.svg`, { waitUntil: 'load', timeout: 60_000 });
    await seedIndexedDbFixture(page, JSON.stringify(fixture), fixture);
    await page.goto(`${site}/`, { waitUntil: 'load', timeout: 60_000 });
    await page.locator('.app[data-document-status="ready"]').waitFor({
      state: 'attached',
      timeout: 60_000,
    });
    const name = page.getByLabel('System name');
    if ((await name.inputValue()) !== fixture.name) {
      throw new Error('The deployed editor did not restore the RTC fixture.');
    }
    const canvas = page.locator('.maplibregl-canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 60_000 });
    const pause = page.getByLabel('Pause the simulation (K)');
    await pause.waitFor({ state: 'visible', timeout: 30_000 });
    await page.keyboard.press('k');
    await page.getByLabel('Run the simulation (K)').waitFor({
      state: 'visible',
      timeout: 30_000,
    });
    const bounds = await canvas.boundingBox();
    if (!bounds) throw new Error('The deployed RTC map has no interactive bounds.');
    const before = await canvas.screenshot();
    const startX = bounds.x + bounds.width / 2;
    const startY = bounds.y + bounds.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(startX + 120, startY + 40, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(250);
    const after = await canvas.screenshot();
    if (before.equals(after)) {
      throw new Error('The deployed RTC map did not repaint after a trusted pan gesture.');
    }
  } finally {
    await closeContext(context);
  }
}

async function main(): Promise<void> {
  const site = siteFromArgs(process.argv.slice(2));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    await exerciseRtcEditor(browser, site);
    const onboarding = await capturePlaywrightOnboardingJourney({
      browser,
      protocol: createPerfProtocol('desktop', 'smoke'),
      previewUrl: site,
    });
    const violations = onboardingJourneyViolations(onboarding);
    if (violations.length > 0) throw new Error(violations.join(' '));
    console.log('Live production RTC interaction and onboarding walkthrough passed.');
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
