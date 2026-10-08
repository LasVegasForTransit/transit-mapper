import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const workflow = readFileSync(resolve(root, '.github/workflows/preview.yml'), 'utf8');

test('PR publication and teardown use the reviewed named-only shared boundary', () => {
  expect(workflow).toContain('types: [opened, reopened, synchronize, closed]');
  expect(workflow).toMatch(/release-pr-preview\.yml@[a-f0-9]{40}/u);
  expect(workflow).toContain('publication-mode: named-staging');
  expect(workflow).toContain('preview-environment: preview');
  expect(workflow).toContain('protection: public');
  expect(workflow).toContain('preview-script: api');
  expect(workflow).toContain('smoke-script: api');
  expect(workflow).toContain('browser-script: release:acceptance');
  expect(workflow).not.toContain('cf deploy');
  expect(workflow).not.toContain('workers/scripts/');
  expect(workflow).not.toContain('TRANSITMAPPER_PREVIEW_DB_ID');
});
