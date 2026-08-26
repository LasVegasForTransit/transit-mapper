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
const attachmentPaths = [
  'apps/web/src/editor/editor-map-attachment.ts',
  'apps/web/src/editor/editor-map-gesture.ts',
  'apps/web/src/editor/editor-map-projection.ts',
  'apps/web/src/editor/editor-map-view.ts',
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
          source.endsWith('/map-view-provider.tsx'),
      );

    expect(forbidden).toEqual([]);
  });

  it('keeps the editor map attachment outside application lifecycle graphs', () => {
    const result = runDependencyCruiser(attachmentPaths, 'json');
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as DependencyCruiserReport;
    const forbidden = report.modules
      .map((module) => module.source)
      .filter(
        (source) =>
          source.endsWith('/react') ||
          source.includes('/react/') ||
          source.endsWith('/App.tsx') ||
          source.endsWith('/EditorProvider.tsx') ||
          source.endsWith('/map-view-provider.tsx') ||
          source.includes('/src/import/') ||
          source.includes('/src/pwa/') ||
          source.includes('/src/storage/'),
      );

    expect(forbidden).toEqual([]);
  });
});
