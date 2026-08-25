import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface DependencyModule {
  source: string;
}

interface DependencyCruiserReport {
  modules: DependencyModule[];
}

const repositoryRoot = resolve(import.meta.dirname, '../../../..');
const adapterPaths = [
  'apps/web/src/editor/document-map-source.ts',
  'apps/web/src/editor/editor-selection.ts',
  'apps/web/src/editor/document-map.ts',
];

function runDependencyCruiser(paths: readonly string[], outputType = 'err-long') {
  return spawnSync(
    resolve(repositoryRoot, 'node_modules/.bin/dependency-cruiser'),
    [
      '--config',
      resolve(repositoryRoot, 'dependency-cruiser.config.mjs'),
      '--output-type',
      outputType,
      ...paths,
    ],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
}

describe('the editor document map dependency boundary', () => {
  it('keeps shared map packages free from editor application modules', () => {
    const result = runDependencyCruiser([
      'packages/map/src',
      'packages/renderer/src',
      'packages/workspace/src',
    ]);
    if (result.error) throw result.error;

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });

  it('keeps the editor adapters outside React provider graphs', () => {
    const result = runDependencyCruiser(adapterPaths, 'json');
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as DependencyCruiserReport;
    const forbidden = report.modules
      .map((module) => module.source)
      .filter(
        (source) =>
          source.endsWith('/react') ||
          source.includes('/react/') ||
          source.endsWith('/EditorProvider.tsx') ||
          source.endsWith('/ViewProvider.tsx'),
      );

    expect(forbidden).toEqual([]);
  });
});
