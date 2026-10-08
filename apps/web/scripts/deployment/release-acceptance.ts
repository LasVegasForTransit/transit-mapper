import { spawnSync } from 'node:child_process';
const site = process.env.PLAYWRIGHT_BASE_URL;
if (!site) throw new Error('PLAYWRIGHT_BASE_URL must identify the selected retained release.');
for (const script of ['smoke:deployed', 'perf:live-production']) {
  const result = spawnSync('pnpm', [script, '--', '--site', site], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed for the selected retained release.`);
}
