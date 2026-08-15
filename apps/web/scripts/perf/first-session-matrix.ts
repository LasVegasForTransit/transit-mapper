import type { PerfFirstSessionSample } from '../../src/perf/types';

export interface FirstSessionSurfaceRunner {
  runNewUserEditor(): Promise<PerfFirstSessionSample>;
  runPublicShare(): Promise<PerfFirstSessionSample>;
  runCrossSiteEmbed(): Promise<PerfFirstSessionSample>;
}

export async function runFirstSessionMatrix(
  runner: FirstSessionSurfaceRunner,
): Promise<PerfFirstSessionSample[]> {
  const samples: PerfFirstSessionSample[] = [];
  samples.push(await runner.runNewUserEditor());
  samples.push(await runner.runPublicShare());
  samples.push(await runner.runCrossSiteEmbed());
  return samples;
}
