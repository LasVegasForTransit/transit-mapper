import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { LngLat } from '@transitmapper/core/model/system';
import type { Browser } from 'playwright-core';
import { generatePerfFixture } from '../../src/perf/fixtures';
import type { PerfProtocol } from '../../src/perf/types';
import { closeContext, installPerformanceInstrumentation, seedLegacyFixture } from './browser';
import {
  type BrowserOverlaySnapshot,
  type PerfPageWindow,
  PERF_STORAGE_CONTRACT,
} from './browserContract';

const PWA_RUNTIME_REPORT_FILENAME = 'pwa-runtime-report.json';

interface OfflineStationSnapshot {
  coord: LngLat;
  revision: number;
}

interface OfflineEditProof {
  stationId: string;
  before: OfflineStationSnapshot;
  after: OfflineStationSnapshot;
}

interface OfflineRuntimeReport {
  schemaVersion: 3;
  generatedAt: string;
  cacheEvicted: true;
  offline: true;
  serviceWorkerControlled: true;
  documentName: string;
  storageMigration: {
    indexedDbDocument: true;
    indexedDbLibraryEntry: true;
    legacyDocumentRemoved: true;
  };
  overlay: BrowserOverlaySnapshot;
  edit: OfflineEditProof;
}

async function verifyLegacyMigration(page: import('playwright-core').Page, id: string) {
  return page.evaluate(
    async ({ expectedId, storage }) => {
      const database = await new Promise<IDBDatabase>((resolvePromise, reject) => {
        const request = indexedDB.open(storage.databaseName, storage.databaseVersion);
        request.onsuccess = () => resolvePromise(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(
        [storage.documentStore, storage.libraryStore],
        'readonly',
      );
      const documentRequest = transaction.objectStore(storage.documentStore).get(expectedId);
      const libraryRequest = transaction.objectStore(storage.libraryStore).get(expectedId);
      const [documentRecord, libraryEntry] = await Promise.all([
        new Promise<{ id?: string; serialized?: string } | undefined>((resolvePromise, reject) => {
          documentRequest.onsuccess = () =>
            resolvePromise(
              documentRequest.result as { id?: string; serialized?: string } | undefined,
            );
          documentRequest.onerror = () => reject(documentRequest.error);
        }),
        new Promise<{ id?: string } | undefined>((resolvePromise, reject) => {
          libraryRequest.onsuccess = () =>
            resolvePromise(libraryRequest.result as { id?: string } | undefined);
          libraryRequest.onerror = () => reject(libraryRequest.error);
        }),
      ]);
      database.close();
      return {
        indexedDbDocument:
          documentRecord?.id === expectedId &&
          typeof documentRecord.serialized === 'string' &&
          (JSON.parse(documentRecord.serialized) as { id?: string }).id === expectedId,
        indexedDbLibraryEntry: libraryEntry?.id === expectedId,
        legacyDocumentRemoved:
          localStorage.getItem(`${storage.legacySystemPrefix}${expectedId}`) === null,
      };
    },
    { expectedId: id, storage: PERF_STORAGE_CONTRACT },
  );
}

async function verifyOfflineStationEdit(
  page: import('playwright-core').Page,
  stationId: string,
): Promise<OfflineEditProof> {
  await page.keyboard.press('v');
  const before = await page.evaluate((targetId) => {
    const snapshot = (window as PerfPageWindow).__perfStationSnapshot?.(targetId);
    const project = (window as PerfPageWindow).__perfProjectLngLat;
    if (!snapshot || !project) throw new Error('The offline editor seams are unavailable.');
    return { snapshot, point: project(snapshot.coord) };
  }, stationId);
  const canvas = await page.locator('.maplibregl-canvas').first().boundingBox();
  if (
    !canvas ||
    before.point.x < canvas.x ||
    before.point.x > canvas.x + canvas.width ||
    before.point.y < canvas.y ||
    before.point.y > canvas.y + canvas.height
  ) {
    throw new Error('The offline station edit target is outside the map viewport.');
  }
  await page.mouse.move(before.point.x, before.point.y);
  await page.mouse.down();
  await page.mouse.move(before.point.x + 24, before.point.y + 12, { steps: 6 });
  await page.mouse.up();
  await page.evaluate(
    () =>
      new Promise<void>((resolvePromise) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolvePromise()));
      }),
  );
  const after = await page.evaluate(
    (targetId) => (window as PerfPageWindow).__perfStationSnapshot?.(targetId) ?? null,
    stationId,
  );
  if (
    !after ||
    after.revision === before.snapshot.revision ||
    (after.coord[0] === before.snapshot.coord[0] && after.coord[1] === before.snapshot.coord[1])
  ) {
    throw new Error('The cache-evicted offline editor did not commit the station edit.');
  }
  return {
    stationId,
    before: before.snapshot,
    after,
  };
}

export async function verifyCacheEvictedOfflineReload(
  browser: Browser,
  protocol: PerfProtocol,
  previewUrl: string,
  outputDirectory: string,
): Promise<void> {
  const context = await browser.newContext({
    viewport: {
      width: protocol.viewport.width,
      height: protocol.viewport.height,
    },
    deviceScaleFactor: protocol.viewport.deviceScaleFactor,
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const fixture = generatePerfFixture('small');
  try {
    await page.goto(`${previewUrl}/favicon.svg`, { waitUntil: 'load', timeout: 60_000 });
    await seedLegacyFixture(page, JSON.stringify(fixture), fixture.id);
    await installPerformanceInstrumentation(page);
    await page.goto(`${previewUrl}/`, { waitUntil: 'load', timeout: 60_000 });
    const name = page.getByLabel('System name');
    await name.waitFor({ state: 'visible', timeout: 60_000 });
    const initialDocumentName = await name.inputValue();
    if (initialDocumentName !== fixture.name) {
      const storageState = await page.evaluate((storage) => {
        const activeId = localStorage.getItem(storage.activeIdKey);
        return {
          activeId,
          activeSystem: localStorage
            .getItem(`${storage.legacySystemPrefix}${activeId ?? ''}`)
            ?.slice(0, 80),
        };
      }, PERF_STORAGE_CONTRACT);
      throw new Error(
        `The online PWA bootstrap restored "${initialDocumentName}" instead of ` +
          `"${fixture.name}" (${JSON.stringify(storageState)}).`,
      );
    }

    const migration = await verifyLegacyMigration(page, fixture.id);
    if (
      !migration.indexedDbDocument ||
      !migration.indexedDbLibraryEntry ||
      !migration.legacyDocumentRemoved
    ) {
      throw new Error(
        `The online bootstrap did not migrate the legacy fixture to IndexedDB: ` +
          JSON.stringify(migration),
      );
    }
    await page.evaluate(async () => navigator.serviceWorker.ready);
    if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
      await page.reload({ waitUntil: 'load', timeout: 60_000 });
    }
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 30_000,
    });

    // Every local byte for this reload must come from Workbox, not HTTP cache.
    await session.send('Network.clearBrowserCache');
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load', timeout: 60_000 });
    await name.waitFor({ state: 'visible', timeout: 60_000 });
    const documentName = await name.inputValue();
    if (documentName !== fixture.name) {
      throw new Error(
        `The cache-evicted offline reload restored "${documentName}" instead of ` +
          `"${fixture.name}".`,
      );
    }
    await page.waitForFunction(
      () => {
        const overlay = (window as PerfPageWindow).__perfOverlaySnapshot?.();
        return (
          overlay?.sourceExists === true &&
          overlay.layerExists === true &&
          overlay.sourceLoaded === true &&
          overlay.featureCount > 0
        );
      },
      undefined,
      { timeout: 30_000 },
    );
    const overlay = await page.evaluate(() => {
      const snapshot = (window as PerfPageWindow).__perfOverlaySnapshot?.();
      if (!snapshot) throw new Error('The offline overlay proof seam is unavailable.');
      return snapshot;
    });
    const stationId = fixture.stations[Math.floor(fixture.stations.length / 2)]?.id;
    if (!stationId) throw new Error('The offline fixture has no station edit target.');
    const edit = await verifyOfflineStationEdit(page, stationId);

    const report: OfflineRuntimeReport = {
      schemaVersion: 3,
      generatedAt: new Date().toISOString(),
      cacheEvicted: true,
      offline: true,
      serviceWorkerControlled: true,
      documentName,
      storageMigration: {
        indexedDbDocument: true,
        indexedDbLibraryEntry: true,
        legacyDocumentRemoved: true,
      },
      overlay,
      edit,
    };
    await writeFile(
      resolve(outputDirectory, PWA_RUNTIME_REPORT_FILENAME),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    console.log('PWA runtime: cache-evicted offline editor reload passed.');
  } finally {
    await context.setOffline(false).catch(() => undefined);
    await closeContext(context);
  }
}
