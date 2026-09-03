import type { Page } from 'playwright-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as FsPromisesModule from 'node:fs/promises';
import { PERF_SCENARIOS } from '../../../src/perf/scenarios';

const readFile = vi.hoisted(() => vi.fn(() => Promise.resolve('<html>embed</html>')));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof FsPromisesModule>()),
  readFile,
}));

import { configureSurfaceRoutes } from '../../../scripts/perf/browser';

describe('performance surface routes', () => {
  beforeEach(() => readFile.mockClear());

  it('reads an embed document from the active preview artifact', async () => {
    const embedHtmlPath = '/instrumented-artifact/embed-document';
    const page = { route: vi.fn(() => Promise.resolve()) } as unknown as Page;

    await configureSurfaceRoutes(page, PERF_SCENARIOS.embed, '{}', { embedHtmlPath });

    expect(readFile).toHaveBeenCalledWith(embedHtmlPath, 'utf8');
  });
});
