import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
test('legacy selection skips the absent proof without granting library authorization', async () => {
  const publish = await readFile(
    new URL('../../../.github/workflows/release-publish.yml', import.meta.url),
    'utf8',
  );
  const source = await readFile(
    new URL('../../../.github/workflows/release-source.yml', import.meta.url),
    'utf8',
  );
  expect(source).toContain('value: ${{ jobs.source.outputs.legacy }}');
  expect(source).toContain('legacy: ${{ steps.source.outputs.legacy }}');
  expect(publish).toMatch(/legacy-artifact:\s+type: boolean\s+required: false\s+default: false/);
  expect(
    publish.match(/if: inputs.attestation-prefix != '' && !inputs.legacy-artifact/g),
  ).toHaveLength(3);
  const proofSelections = publish.split('\n').filter((line) => line.includes('then proof='));
  expect(proofSelections.length).toBeGreaterThan(0);
  for (const line of proofSelections) expect(line).toContain('"$LEGACY_ARTIFACT" != true');
  expect(publish).not.toContain('--legacy');
});
