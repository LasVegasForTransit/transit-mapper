import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface BoundaryResult {
  status: number | null;
  output: string;
}

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const temporaryDirectories: string[] = [];

function runBoundary(paths: readonly string[], cwd = repositoryRoot): BoundaryResult {
  const result = spawnSync(
    resolve(repositoryRoot, 'node_modules/.bin/dependency-cruiser'),
    ['--config', resolve(repositoryRoot, 'dependency-cruiser.config.mjs'), ...paths],
    { cwd, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function runBoundaryFixture(files: Readonly<Record<string, string>>): BoundaryResult {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'transitmapper-renderer-boundary-'));
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
  return runBoundary(['packages'], fixtureRoot);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('the renderer package dependency boundary', () => {
  it.each([
    [
      'editor',
      '../../../apps/web/src/editor/editor-application',
      'apps/web/src/editor/editor-application.ts',
    ],
    ['application', '../../../apps/web/src/app/app-root', 'apps/web/src/app/app-root.ts'],
    ['simulation', '../../../apps/web/src/sim/simulation', 'apps/web/src/sim/simulation.ts'],
    [
      'persistence',
      '../../../apps/web/src/storage/system-store',
      'apps/web/src/storage/system-store.ts',
    ],
    ['UI', '../../../apps/web/src/ui/button', 'apps/web/src/ui/button.ts'],
  ])('rejects a renderer import from %s', (_name, importPath, dependencyPath) => {
    const result = runBoundaryFixture({
      'packages/renderer/src/boundary-probe.ts': `import '${importPath}';\n`,
      [dependencyPath]: 'export {};\n',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('renderer-package-dependencies-are-an-allowlist');
  });

  it('rejects a React import from renderer', () => {
    const result = runBoundaryFixture({
      'packages/renderer/src/boundary-probe.ts': "import 'react';\n",
      'node_modules/react/package.json': JSON.stringify({ name: 'react', main: 'index.js' }),
      'node_modules/react/index.js': 'export {};\n',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('renderer-package-dependencies-are-an-allowlist');
  });
});
