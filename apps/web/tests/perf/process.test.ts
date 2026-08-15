import { describe, expect, it } from 'vitest';
import {
  PERFORMANCE_HARNESS_OUTPUT_DIRECTORY,
  PERFORMANCE_PUBLIC_OUTPUT_DIRECTORY,
  performancePreviewArguments,
  previewUrl,
} from '../../scripts/perf/process';

describe('performance artifact delivery', () => {
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
});
