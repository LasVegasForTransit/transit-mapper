#!/usr/bin/env tsx

import { parseRendererCaptureCliOptions, rendererCaptureUsage } from './cli';
import { runRendererCapture } from './capture';

async function main(): Promise<void> {
  const options = parseRendererCaptureCliOptions(process.argv.slice(2));
  if (options.help) {
    console.log(rendererCaptureUsage());
    return;
  }
  await runRendererCapture(options);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`renderer capture failed: ${message}`);
  process.exitCode = 2;
});
