#!/usr/bin/env tsx

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDocumentPresentationState } from '@transitmapper/map/presentation';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { generatePerfFixture } from '../../src/perf/fixtures';
import { PERF_SCENARIOS } from '../../src/perf/scenarios';
import { closeContext, configureSurfaceRoutes, seedIndexedDbFixture } from './browser';
import { assertBasemapPainted, assertMapSurfacePainted, routeBasemapProof } from './map-paint';
import {
  PERFORMANCE_PUBLIC_OUTPUT_DIRECTORY,
  startPreview,
  stopPreview,
  type RunningPreview,
} from './process';

const SHARE_ID = 'perfshare';
const VIEW_ID = 'perfview';

async function createContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1_440, height: 900 },
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  });
  await context.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
    }),
  );
  return context;
}

async function visibleMap(page: Page, subject: string): Promise<void> {
  const canvas = page.locator('.maplibregl-canvas').first();
  await canvas.waitFor({ state: 'visible', timeout: 30_000 });
  const bounds = await canvas.boundingBox();
  if (!bounds || bounds.width < 100 || bounds.height < 100) {
    throw new Error('The map did not expose usable interactive bounds.');
  }
  // Bounds prove the canvas is laid out, not that anything reached it. A map
  // whose worker never started keeps its geometry and paints nothing.
  await assertMapSurfacePainted(page, subject);
}

async function exerciseEditor(browser: Browser, site: string): Promise<void> {
  const fixture = generatePerfFixture('small');
  const context = await createContext(browser);
  const page = await context.newPage();
  try {
    await page.goto(`${site}/favicon.svg`, { waitUntil: 'load', timeout: 30_000 });
    await seedIndexedDbFixture(page, JSON.stringify(fixture), fixture);
    await page.goto(`${site}/`, { waitUntil: 'load', timeout: 30_000 });
    await page.locator('.app[data-document-status="ready"]').waitFor({
      state: 'attached',
      timeout: 30_000,
    });
    if ((await page.getByLabel('System name').inputValue()) !== fixture.name) {
      throw new Error('The editor did not restore the seeded system.');
    }
    await visibleMap(page, 'the editor');
  } finally {
    await closeContext(context);
  }
}

async function configurePublishedRoutes(page: Page): Promise<void> {
  const fixture = generatePerfFixture('small');
  const serialized = JSON.stringify(fixture);
  await configureSurfaceRoutes(page, PERF_SCENARIOS.viewer, serialized);
  await page.route(`**/api/v1/views/${VIEW_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        view: {
          schemaVersion: 1,
          id: VIEW_ID,
          title: 'Release smoke View',
          map: { kind: 'shared-system', id: SHARE_ID },
          state: createDocumentPresentationState({ camera: fixture.viewport }),
        },
        createdAt: 0,
        updatedAt: 0,
      }),
    }),
  );
  const embedHtml = await readFile(
    resolve(PERFORMANCE_PUBLIC_OUTPUT_DIRECTORY, 'embed.html'),
    'utf8',
  );
  await page.route(`**/embed/${VIEW_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: embedHtml }),
  );
}

async function exerciseWorkspaceRoute(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  await page.locator('.viewer-brand').waitFor({ state: 'visible', timeout: 30_000 });
  await visibleMap(page, url);
}

async function exercisePublishedSurfaces(browser: Browser, site: string): Promise<void> {
  const context = await createContext(browser);
  const page = await context.newPage();
  try {
    await configurePublishedRoutes(page);
    await exerciseWorkspaceRoute(page, `${site}/s/${SHARE_ID}`);
    await exerciseWorkspaceRoute(page, `${site}/v/${VIEW_ID}`);

    const fixture = generatePerfFixture('small');
    await configureSurfaceRoutes(page, PERF_SCENARIOS.embed, JSON.stringify(fixture));
    await page.goto(`${site}/e/perfembed`, { waitUntil: 'load', timeout: 30_000 });
    await visibleMap(page, 'the share embed');
    await page.goto(`${site}/embed/${VIEW_ID}`, { waitUntil: 'load', timeout: 30_000 });
    await visibleMap(page, 'the named View embed');
  } finally {
    await closeContext(context);
  }
}

/**
 * The editor with no seeded system, over a basemap whose only visible content
 * comes from a source. Nothing of ours can paint here, so the assertion can
 * only pass when the basemap itself reached the canvas.
 *
 * This is the enforcement for the invariant in CLAUDE.md: a map surface never
 * shows an empty backdrop where a basemap belongs.
 */
async function exerciseBasemap(browser: Browser, site: string): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1_440, height: 900 },
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  });
  await routeBasemapProof(context);
  const page = await context.newPage();
  try {
    await page.goto(`${site}/`, { waitUntil: 'load', timeout: 30_000 });
    await page.locator('.app[data-document-status="ready"]').waitFor({
      state: 'attached',
      timeout: 30_000,
    });
    await assertBasemapPainted(page, 'the editor basemap');
  } finally {
    await closeContext(context);
  }
}

async function main(): Promise<void> {
  let preview: RunningPreview | undefined;
  let browser: Browser | undefined;
  try {
    preview = await startPreview('public');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    await exerciseEditor(browser, preview.url);
    await exercisePublishedSurfaces(browser, preview.url);
    await exerciseBasemap(browser, preview.url);
    console.log(
      'Release editor, viewer, named View, and embed journeys passed, and the basemap painted.',
    );
  } finally {
    await browser?.close();
    await stopPreview(preview);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
