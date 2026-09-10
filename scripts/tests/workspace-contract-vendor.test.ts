import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');

describe('workspace contract', () => {
  it('accepts LVBT packages from the recorded vendor tree', () => {
    expect(() =>
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/check-workspace-contract.ts'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('keeps staged formatting on the consumer configuration', () => {
    const hook = readFileSync(resolve(ROOT, '.githooks/pre-commit'), 'utf8');

    expect(hook).toContain('lint-staged --config "$ROOT/package.json"');
  });

  it('keeps repository config policy outside the vendor tree', () => {
    expect(() =>
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/check-config.ts'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
