import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  readReleaseConfiguration,
  runReleaseSmoke,
} from '@lasvegasfortransit/web-platform/release';

const root = fileURLToPath(new URL('../../../', import.meta.url));
await runReleaseSmoke(await readReleaseConfiguration(root), chromium);
