import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface BoundaryResult {
  status: number | null;
  output: string;
}

const repositoryRoot = resolve(import.meta.dirname, '../..');
const temporaryDirectories: string[] = [];

function runBoundaryFixture(files: Readonly<Record<string, string>>): BoundaryResult {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'transitmapper-map-boundary-'));
  temporaryDirectories.push(fixtureRoot);
  writeFileSync(
    join(fixtureRoot, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: {}, include: ['apps/**/*', 'packages/**/*'] }),
  );
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  }

  const result = spawnSync(
    join(repositoryRoot, 'node_modules/.bin/dependency-cruiser'),
    ['--config', join(repositoryRoot, 'dependency-cruiser.config.mjs'), 'packages'],
    { cwd: fixtureRoot, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('the map package dependency boundary', () => {
  it.each([
    ['core', '../../core/src/index', 'packages/core/src/index.ts'],
    ['renderer', '../../renderer/src/index', 'packages/renderer/src/index.ts'],
    ['workspace', '../../workspace/src/index', 'packages/workspace/src/index.ts'],
    [
      'editor',
      '../../../apps/web/src/editor/editor-application',
      'apps/web/src/editor/editor-application.ts',
    ],
    [
      'viewer',
      '../../../apps/web/src/viewer/viewer-application',
      'apps/web/src/viewer/viewer-application.ts',
    ],
    ['application', '../../../apps/web/src/app/app-root', 'apps/web/src/app/app-root.ts'],
  ])('rejects an import from %s', (_name, importPath, dependencyPath) => {
    const result = runBoundaryFixture({
      'packages/map/src/map-runtime.ts': `import '${importPath}';\n`,
      [dependencyPath]: 'export {};\n',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('map-package-dependencies-are-an-allowlist');
  });

  it('rejects a React import', () => {
    const result = runBoundaryFixture({
      'packages/map/src/map-runtime.ts': "import 'react';\n",
      'node_modules/react/package.json': JSON.stringify({ name: 'react', main: 'index.js' }),
      'node_modules/react/index.js': 'export {};\n',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('map-package-dependencies-are-an-allowlist');
  });

  it('permits views, MapLibre, and internal map modules', () => {
    const result = runBoundaryFixture({
      'packages/map/src/map-runtime.ts':
        "import './map-view-store';\nimport '../../views/src/index';\nimport 'maplibre-gl';\n",
      'packages/map/src/map-view-store.ts': 'export {};\n',
      'packages/views/src/index.ts': 'export {};\n',
      'node_modules/maplibre-gl/package.json': JSON.stringify({
        name: 'maplibre-gl',
        main: 'index.js',
      }),
      'node_modules/maplibre-gl/index.js': 'export {};\n',
    });

    expect(result.status, result.output).toBe(0);
    expect(result.output).not.toContain('map-package-dependencies-are-an-allowlist');
  });
});
