import { expect, test } from 'vitest';
import { releaseMarkerAssets } from '../src/release-marker-assets.js';
test('selective and default asset routing reaches both generated identity endpoints without changing product routes', () => {
  const existing = { binding: 'ASSETS', directory: 'dist', run_worker_first: ['/api/*', '/s/*'] };
  expect(releaseMarkerAssets(existing, '/funding/')).toEqual({
    ...existing,
    run_worker_first: ['/api/*', '/s/*', '/lvbt-release.json', '/funding/lvbt-release.json'],
  });
  expect(releaseMarkerAssets({ run_worker_first: false })).toEqual({
    run_worker_first: ['/lvbt-release.json'],
  });
  expect(releaseMarkerAssets({ binding: 'ASSETS' })).toEqual({
    binding: 'ASSETS',
    run_worker_first: ['/lvbt-release.json'],
  });
  expect(existing.run_worker_first).toEqual(['/api/*', '/s/*']);
});
test('all-Worker routing remains true and already normalized marker paths are not duplicated', () => {
  expect(releaseMarkerAssets({ run_worker_first: true })).toEqual({ run_worker_first: true });
  expect(releaseMarkerAssets({ run_worker_first: ['/lvbt-release.json'] })).toEqual({
    run_worker_first: ['/lvbt-release.json'],
  });
});
