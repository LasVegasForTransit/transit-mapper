import { isDeepStrictEqual } from 'node:util';

export function verifyExecutor(report, environment, dryRun) {
  if (dryRun && !environment.GITHUB_EVENT_NAME) return;
  const pairs = [
    [environment.GITHUB_REPOSITORY, report.repository],
    [environment.GITHUB_RUN_ID, String(report.run.id)],
    [environment.GITHUB_RUN_ATTEMPT, String(report.run.attempt)],
    [environment.GITHUB_SHA, report.commit],
    [environment.GITHUB_REF_NAME, report.run.headBranch],
    [environment.GITHUB_EVENT_NAME, report.run.event],
  ];
  if (
    !['schedule', 'workflow_dispatch'].includes(environment.GITHUB_EVENT_NAME) ||
    pairs.some(([actual, expected]) => actual !== expected)
  )
    throw new Error('Issue writes require the matching trusted workflow executor identity.');
  if (
    environment.GITHUB_WORKFLOW_REF &&
    environment.GITHUB_WORKFLOW_REF !==
      `${report.repository}/${report.run.workflow}@refs/heads/${report.run.headBranch}`
  )
    throw new Error('Current workflow execution does not match the contribution evidence.');
}
export async function verifySourceConfiguration(report, config, gh, namespace) {
  const stored = await gh([
    'api',
    `repos/${report.repository}/contents/.lvbt/tooling.json?ref=${report.commit}`,
  ]);
  if (stored.type !== 'file' || stored.encoding !== 'base64' || typeof stored.content !== 'string')
    throw new Error('Could not read configuration at the verified source commit.');
  const canonical = JSON.parse(Buffer.from(stored.content, 'base64').toString('utf8'));
  if (!isDeepStrictEqual(canonical[namespace], config[namespace]))
    throw new Error('Declarations differ from configuration at the verified source commit.');
}
