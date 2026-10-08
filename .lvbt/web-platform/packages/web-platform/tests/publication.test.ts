import { expect, test } from 'vitest';
import { publicationReceipt } from '../src/publication.js';

test('an uncertain activation retains the selected app URL and cannot report confirmation', () => {
  const receipt = publicationReceipt({
    release: { releaseId: '123', commit: 'a'.repeat(40) },
    baseline: null,
    activation: 'failure',
    verification: 'skipped',
    url: 'https://example.org',
  });
  expect(receipt.url).toBe('https://example.org');
  expect(receipt.activation).toBe('unknown');
  expect(receipt.verification).toBe('skipped');
});
