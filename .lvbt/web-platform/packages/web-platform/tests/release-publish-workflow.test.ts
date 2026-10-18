import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
test('preview schema applies before candidate acceptance, production applies after acceptance, and profiles serialize publication', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/release-publish.yml', import.meta.url),
    'utf8',
  );
  const order = [
    'Apply retained preview schema',
    'Upload candidate',
    'Verify candidate',
    'Browser acceptance',
    'Apply retained production schema',
    'Activate verified',
  ];
  const positions = order.map((name) => workflow.indexOf(`name: ${name}`));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(workflow).toContain('lvbt-publish-${{ github.repository }}-${{ inputs.app');
  expect(workflow).toContain('cancel-in-progress: false');
  expect(workflow).toContain('secrets.CLOUDFLARE_PREVIEW_API_TOKEN');
  expect(workflow).toContain("steps.upload.outputs.protected == 'true'");
});

test('named production installs Chromium before its browser-backed public smoke', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/release-publish.yml', import.meta.url),
    'utf8',
  );
  const namedProduction = workflow.slice(workflow.indexOf('  named-production:'));

  expect(namedProduction).toContain('name: Install Chromium');
  expect(namedProduction.indexOf('name: Install Chromium')).toBeLessThan(
    namedProduction.indexOf('name: Verify activated origin'),
  );
});

test('every migration step supplies a separate D1 credential without overriding the publisher credential', async () => {
  const workflow = await readFile(
    new URL('../../../.github/workflows/release-publish.yml', import.meta.url),
    'utf8',
  );
  const migrations = workflow
    .split('      - name: ')
    .filter((step) => step.startsWith('Apply retained '));
  expect(migrations).toHaveLength(4);
  for (const step of migrations) {
    const environment = step.slice(step.indexOf('        env:'), step.indexOf('        run:'));
    expect(environment).toMatch(/^\s+CLOUDFLARE_MIGRATIONS_API_TOKEN:/mu);
    expect(environment).not.toMatch(/^\s+CLOUDFLARE_API_TOKEN:/mu);
    expect(environment).toContain('secrets.CLOUDFLARE_MIGRATIONS_API_TOKEN ||');
    if (step.startsWith('Apply retained production schema'))
      expect(step).toContain('--expected-version "$EXPECTED_PRODUCTION_VERSION"');
  }
});
