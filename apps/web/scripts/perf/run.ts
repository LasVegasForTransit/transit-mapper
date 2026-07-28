#!/usr/bin/env tsx

import { parsePerfCliOptions, perfUsage } from './cli';
import { runPerformanceAudit } from './orchestrator';

async function main(): Promise<void> {
  const options = parsePerfCliOptions(process.argv.slice(2));
  if (options.help) {
    console.log(perfUsage());
    return;
  }
  await runPerformanceAudit(options);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`performance harness failed before it could write a report: ${message}`);
  process.exitCode = 2;
});
