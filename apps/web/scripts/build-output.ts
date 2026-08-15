import { resolve } from 'node:path';

/**
 * Browser-only seams need an isolated artifact so the public delivery graph
 * stays the source of truth for first-session byte capture. PWA transforms
 * must follow that same directory or their generated cache list can point at
 * a different build's hashed files.
 */
export function resolveBuildOutputDirectory(appRoot: string, performanceHarness: boolean): string {
  return resolve(appRoot, performanceHarness ? '.perf-harness-dist' : 'dist');
}
