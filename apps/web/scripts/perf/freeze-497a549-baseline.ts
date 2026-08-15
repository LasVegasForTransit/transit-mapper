#!/usr/bin/env tsx

import { runLegacy497a549Baseline } from './historic-baseline';

runLegacy497a549Baseline().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`legacy baseline harness failed before freeze: ${message}`);
  process.exitCode = 2;
});
