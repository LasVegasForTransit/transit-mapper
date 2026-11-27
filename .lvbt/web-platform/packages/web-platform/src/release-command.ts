import path from 'node:path';
import { runIsolatedPrPreview } from './isolated-pr-preview-command.js';
import { runPrPreview } from './release-pr-preview-command.js';
import { runReleaseAttestation } from './release-attestation.js';
import { readReleaseConfiguration } from './release-config.js';
import { runPromote } from './promote-command.js';
import { runWorkerRelease } from './worker-release-command.js';
import { runWorkerReleaseSmoke } from './worker-release-smoke.js';
import { runPublication } from './record-publication-command.js';
import { runReleaseMigrations } from './saved-release-migrations.js';

const [command, root, ...args] = process.argv.slice(2);
if (!root) throw new Error('Pass the repository root.');
const appIndex = args.indexOf('--app');
let app: string | undefined;
if (appIndex >= 0) {
  app = args[appIndex + 1];
  if (!app || app.startsWith('--')) throw new Error('Pass --app with a named release profile.');
  args.splice(appIndex, 2);
}
if (command === 'attestation' && args[0] === 'manifest') {
  await runReleaseAttestation(undefined, args);
} else {
  const config = await readReleaseConfiguration(
    root,
    process.env,
    app ?? process.env.LVBT_RELEASE_APP,
  );
  process.chdir(path.resolve(root, config.appDirectory));
  if (command === 'isolated-pr-preview') await runIsolatedPrPreview(config, args);
  else if (command === 'pr-preview') await runPrPreview(config, args);
  else if (command === 'promote') await runPromote(config, args);
  else if (command === 'worker-release') await runWorkerRelease(config, args);
  else if (command === 'publication') await runPublication(config, args);
  else if (command === 'smoke') await runWorkerReleaseSmoke(config, args);
  else if (command === 'attestation') await runReleaseAttestation(config, args);
  else if (command === 'migrate') await runReleaseMigrations(config, args);
  else throw new Error('Use promote, worker-release, publication, smoke, or migrate.');
}
