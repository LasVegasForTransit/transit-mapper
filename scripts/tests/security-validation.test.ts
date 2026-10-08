import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
const root = resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');
test('pnpm check always audits all dependencies and scans full history without replacing disposable generator acceptance', () => {
  const manifest = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  const turbo = JSON.parse(read('turbo.json')) as {
    tasks: Record<string, { cache?: boolean; dependsOn?: string[] }>;
  };
  expect(manifest.scripts['security:dependencies']).toBe('pnpm audit --audit-level=high');
  expect(manifest.scripts['security:secrets']).toBe('lvbt check secrets');
  for (const task of ['security:dependencies', 'security:secrets']) {
    expect(turbo.tasks['//#' + task]?.cache).toBe(false);
    expect(turbo.tasks.validate?.dependsOn).toContain('//#' + task);
  }
  const ci = read('.github/workflows/ci.yml');
  expect(ci).toContain('fetch-depth: 0');
  expect(ci).toContain('run: pnpm check:generators');
  expect(ci).not.toContain('docker run');
  expect(ci).not.toContain('run: pnpm audit');
});
