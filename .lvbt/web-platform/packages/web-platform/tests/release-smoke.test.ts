import { expect, test } from 'vitest';
import { runReleaseSmoke } from '../src/release-smoke-command.js';
const config = {
  repository: 'Example/app',
  appDirectory: 'app',
  productionUrl: 'https://example.org',
  previewUrl: 'https://preview.example.org',
  productionWorker: 'app',
  previewWorker: 'app-preview',
  artifactPrefix: 'app-release',
  workersDevSubdomain: 'example',
  stagingWorkflow: {
    name: 'Deploy staging',
    path: '.github/workflows/staging.yml',
    branch: 'main',
  },
  promotionWorkflow: { file: 'promote.yml', titlePrefix: 'Promote app', branch: 'main' },
};
const chromium = {
  launch: () => {
    throw new Error('Invalid release must not launch a browser.');
  },
};
test('public release verification rejects another site before requesting or rendering anything', async () => {
  await expect(
    runReleaseSmoke(config, chromium, ['--url', 'https://another.example', '--public']),
  ).rejects.toThrow('configured production origin');
});
test('protected release verification rejects an undeclared origin before sending Access credentials', async () => {
  await expect(
    runReleaseSmoke(config, chromium, ['--url', 'https://another.example', '--protected']),
  ).rejects.toThrow('configured preview');
});
test('release verification rejects insecure and path-scoped origins before a browser can send Access credentials', async () => {
  for (const url of [
    'http://example.org',
    'https://example.org/account',
    'https://example.org/?key=value',
  ]) {
    await expect(runReleaseSmoke(config, chromium, ['--url', url, '--protected'])).rejects.toThrow(
      'HTTPS origin',
    );
  }
});
