import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_HARNESS_OUTPUT_DIRECTORY,
  PERFORMANCE_PUBLIC_OUTPUT_DIRECTORY,
  performancePublicBuildArguments,
  performancePreviewArguments,
  previewUrl,
} from '../../scripts/perf/process';

describe('performance artifact delivery', () => {
  it('builds the public artifact through the workspace dependency graph', () => {
    expect(performancePublicBuildArguments()).toEqual([
      'exec',
      'turbo',
      'run',
      'build',
      '--filter=@transitmapper/web...',
      '--concurrency=2',
    ]);
  });

  it('serves the private harness and public delivery artifacts from distinct output directories', () => {
    expect(PERFORMANCE_HARNESS_OUTPUT_DIRECTORY).not.toBe(PERFORMANCE_PUBLIC_OUTPUT_DIRECTORY);
    expect(performancePreviewArguments('public', 5_181)).toContain(
      PERFORMANCE_PUBLIC_OUTPUT_DIRECTORY,
    );
    expect(performancePreviewArguments('instrumented', 5_182)).toContain(
      PERFORMANCE_HARNESS_OUTPUT_DIRECTORY,
    );
    expect(performancePreviewArguments('public', 5_181)).toContain('5181');
    expect(performancePreviewArguments('instrumented', 5_182)).toContain('5182');
    expect(previewUrl(5_181)).toBe('http://127.0.0.1:5181');
  });

  it('can serve a frozen historical public artifact without substituting the current dist', () => {
    const legacyOutputDirectory = '/tmp/transitmapper-497a549/apps/web/dist';

    expect(
      performancePreviewArguments('public', 5_183, {
        outputDirectory: legacyOutputDirectory,
      }),
    ).toContain(legacyOutputDirectory);
  });
});
