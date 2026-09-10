import { execFileSync } from 'node:child_process';

export function assertDeploymentCheckout(root: string, commit: string): void {
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    }).trim();
  if (git(['rev-parse', 'HEAD']) !== commit)
    throw new Error('Deployments must use the checked-out commit.');
  if (git(['status', '--porcelain', '--untracked-files=all']) !== '') {
    throw new Error('Commit or move local changes before deploying.');
  }
  const branch = process.env.GITHUB_REF ?? git(['branch', '--show-current']);
  if (branch !== 'main' && branch !== 'refs/heads/main')
    throw new Error('Production deployment requires main.');
  const remote = git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
  if (remote !== `${commit}\trefs/heads/main`)
    throw new Error('The checkout no longer matches remote main; refusing an outdated deployment.');
}
