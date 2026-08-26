import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface TurboTask {
  dependsOn?: string[];
  env?: string[];
  outputs?: string[];
}

interface TurboConfig {
  tasks: Record<string, TurboTask | undefined>;
}

const root = resolve(import.meta.dirname, '../..');
const config = JSON.parse(readFileSync(resolve(root, 'turbo.json'), 'utf8')) as TurboConfig;

describe('Turbo build cache ownership', () => {
  it('keeps web release metadata out of shared package build hashes', () => {
    expect(config.tasks.build).toEqual({
      dependsOn: ['^build'],
      outputs: ['dist/**', '*.tsbuildinfo'],
    });
    expect(config.tasks['@transitmapper/web#build']?.env).toEqual([
      'GITHUB_SHA',
      'TRANSITMAPPER_BUILD_COMMIT',
      'TRANSITMAPPER_BUILD_DIRTY',
      'TRANSITMAPPER_RELEASE_TAG',
      'TRANSITMAPPER_PERFORMANCE_SAMPLING_ENABLED',
      'TRANSITMAPPER_PERFORMANCE_ORDINARY_BASIS_POINTS',
      'TRANSITMAPPER_PERFORMANCE_RELEASE_BASIS_POINTS',
      'VITE_PERF_BUILD',
    ]);
  });
});
