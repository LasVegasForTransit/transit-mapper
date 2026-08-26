import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface BoundaryFixture {
  readonly sourcePath: string;
  readonly source: string;
  readonly dependencyPath: string;
  readonly rule: string;
}

const repositoryRoot = resolve(import.meta.dirname, '../../../..');
const temporaryDirectories: string[] = [];

function runBoundaryFixture(fixture: BoundaryFixture) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'transitmapper-map-stack-boundary-'));
  temporaryDirectories.push(fixtureRoot);
  writeFileSync(
    join(fixtureRoot, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: {}, include: ['apps/**/*', 'packages/**/*'] }),
  );
  mkdirSync(join(fixtureRoot, 'apps'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'packages'), { recursive: true });
  for (const [path, contents] of [
    [fixture.sourcePath, fixture.source],
    [fixture.dependencyPath, 'export {};\n'],
  ] as const) {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  }
  const result = spawnSync(
    resolve(repositoryRoot, 'node_modules/.bin/dependency-cruiser'),
    ['--config', resolve(repositoryRoot, 'dependency-cruiser.config.mjs'), 'apps', 'packages'],
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

describe('the reusable map stack dependency directions', () => {
  it.each<BoundaryFixture>([
    {
      sourcePath: 'packages/views/src/probe.ts',
      source: "import '../../map/src/probe';\n",
      dependencyPath: 'packages/map/src/probe.ts',
      rule: 'views-is-the-map-contract-root',
    },
    {
      sourcePath: 'packages/core/src/probe.ts',
      source: "import '../../map/src/probe';\n",
      dependencyPath: 'packages/map/src/probe.ts',
      rule: 'core-does-not-import-the-map-stack',
    },
    {
      sourcePath: 'packages/map/src/probe.ts',
      source: "import '../../workspace/src/probe';\n",
      dependencyPath: 'packages/workspace/src/probe.ts',
      rule: 'map-package-dependencies-are-an-allowlist',
    },
    {
      sourcePath: 'packages/workspace/src/probe.ts',
      source: "import '../../renderer/src/probe';\n",
      dependencyPath: 'packages/renderer/src/probe.ts',
      rule: 'workspace-package-dependencies-are-an-allowlist',
    },
    {
      sourcePath: 'packages/renderer/src/probe.ts',
      source: "import '../../workspace/src/probe';\n",
      dependencyPath: 'packages/workspace/src/probe.ts',
      rule: 'renderer-package-dependencies-are-an-allowlist',
    },
    {
      sourcePath: 'apps/web/src/embed/probe.ts',
      source: "import '../editor/probe';\n",
      dependencyPath: 'apps/web/src/editor/probe.ts',
      rule: 'embed-is-framework-free-and-editor-free',
    },
    {
      sourcePath: 'apps/web/src/embed/probe.ts',
      source: "import '../../../../node_modules/react/index.js';\n",
      dependencyPath: 'node_modules/react/index.js',
      rule: 'embed-is-framework-free-and-editor-free',
    },
    {
      sourcePath: 'apps/web/src/viewer/probe.ts',
      source: "import '../storage/probe';\n",
      dependencyPath: 'apps/web/src/storage/probe.ts',
      rule: 'viewer-startup-excludes-editor-capabilities',
    },
  ])('rejects $sourcePath from importing $dependencyPath', (fixture) => {
    const result = runBoundaryFixture(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(fixture.rule);
  });
});
