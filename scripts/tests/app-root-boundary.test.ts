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
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'transitmapper-app-root-boundary-'));
  temporaryDirectories.push(fixtureRoot);
  writeFileSync(
    join(fixtureRoot, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { jsx: 'react-jsx' }, include: ['apps/**/*'] }),
  );
  for (const [path, contents] of Object.entries(files)) {
    const destination = join(fixtureRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, contents);
  }

  const result = spawnSync(
    join(repositoryRoot, 'node_modules/.bin/dependency-cruiser'),
    ['--config', join(repositoryRoot, 'dependency-cruiser.config.mjs'), 'apps'],
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

describe('the eager AppRoot dependency boundary', () => {
  it('rejects a forbidden implementation reached through a shell-safe intermediary', () => {
    const result = runBoundaryFixture({
      'apps/web/src/main.tsx': "import './perf/startup-marks';\n",
      'apps/web/src/perf/startup-marks.ts': "import '../ui/Workbench';\n",
      'apps/web/src/ui/Workbench.tsx': 'export const Workbench = {};\n',
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain('app-root-eager-closure-is-shell-only');
    expect(result.output).toContain('apps/web/src/ui/Workbench.tsx');
  });

  it('permits a forbidden implementation behind the dynamic route-host edge', () => {
    const result = runBoundaryFixture({
      'apps/web/src/main.tsx': "import './app/app-root';\n",
      'apps/web/src/app/app-root.tsx': "void import('../editor/editor-application');\n",
      'apps/web/src/editor/editor-application.tsx': "import '../ui/Workbench';\n",
      'apps/web/src/ui/Workbench.tsx': 'export const Workbench = {};\n',
    });

    expect(result.status).toBe(0);
    expect(result.output).not.toContain('app-root-eager-closure-is-shell-only');
  });
});
