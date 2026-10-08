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
