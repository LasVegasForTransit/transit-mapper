import { expect, test } from 'vitest';
import { previewUploadReceipt } from '../src/pr-preview-config.js';
test('retained release uploads must return the reviewed workers.dev account, not a namesake Worker', () => {
  const receipt = {
    type: 'version-upload',
    version: 1,
    worker_name: 'app-preview',
    version_id: '12345678-1234-1234-1234-123456789abc',
    preview_url: 'https://12345678-app-preview.other.workers.dev',
  };
  expect(() =>
    previewUploadReceipt(JSON.stringify(receipt), 'app-preview', 'reviewed-account'),
  ).toThrow('account');
  expect(() =>
    previewUploadReceipt(
      JSON.stringify({
        ...receipt,
        preview_url: 'https://12345678-app-preview.reviewed-account.workers.dev',
      }),
      'app-preview',
      'reviewed-account',
    ),
  ).not.toThrow();
});
