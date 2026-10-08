import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
export const idNumber = (id) => BigInt(String(id));

export async function successful(run, command, args, { cwd, message }) {
  const result = await run(command, args, { cwd });
  if (result.status !== 0) throw new Error(result.stderr || message);
  return result.stdout;
}
function verifyIdentity(report, remote, repository, workflow) {
  const matches = [
    [remote.repository?.full_name, report.repository],
    [report.run.repository, report.repository],
    [remote.head_branch, repository.default_branch],
    [report.run.headBranch, remote.head_branch],
    [remote.head_sha, report.commit],
    [report.run.headSha, remote.head_sha],
    [report.run.event, remote.event],
    [remote.path?.split('@')[0], workflow],
    [report.run.workflow, workflow],
    [remote.run_attempt, report.run.attempt],
    [String(remote.id), String(report.run.id)],
    [remote.html_url, report.run.url],
  ];
  if (
    !['schedule', 'workflow_dispatch'].includes(remote.event) ||
    matches.some(([actual, expected]) => actual !== expected)
  )
    throw new Error(
      'Report run is not a trusted default-branch schedule or manual workflow result.',
    );
}
function newer(candidate, remote) {
  if (!['schedule', 'workflow_dispatch'].includes(candidate.event)) return false;
  return (
    idNumber(candidate.id) > idNumber(remote.id) ||
    (String(candidate.id) === String(remote.id) && candidate.run_attempt > remote.run_attempt)
  );
}
async function verifyArtifact(report, evidence, run, cwd) {
  const directory = await mkdtemp(path.join(tmpdir(), 'lvbt-audit-evidence-'));
  try {
    const { artifactName, filename } = evidence;
    const metadata = JSON.parse(
      await successful(
        run,
        'gh',
        ['api', `repos/${report.repository}/actions/runs/${report.run.id}/artifacts?per_page=100`],
        { cwd, message: 'Could not verify audit artifact metadata.' },
      ),
    );
    const artifacts =
      metadata.artifacts?.filter(
        (artifact) => artifact.name === artifactName && !artifact.expired,
      ) ?? [];
    if (artifacts.length !== 1 || !/^\d+$/.test(String(artifacts[0].id)))
      throw new Error('Trusted audit artifact is missing, expired, or ambiguous.');
    await successful(
      run,
      'gh',
      [
        'run',
        'download',
        String(report.run.id),
        '--repo',
        report.repository,
        '--name',
        artifactName,
        '--dir',
        directory,
      ],
      { cwd, message: 'Could not download trusted audit artifact.' },
    );
    const stored = JSON.parse(await readFile(path.join(directory, filename), 'utf8'));
    if (!isDeepStrictEqual(stored, report))
      throw new Error('Input report does not match the trusted workflow artifact.');
    return `${report.run.url}/artifacts/${artifacts[0].id}`;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export async function verifiedRun({ report, workflow, artifactName, filename, run, cwd }) {
  const gh = async (args) =>
    JSON.parse(
      await successful(run, 'gh', args, { cwd, message: 'GitHub provenance verification failed.' }),
    );
  const repository = await gh(['api', `repos/${report.repository}`]);
  const remote = await gh(['api', `repos/${report.repository}/actions/runs/${report.run.id}`]);
  verifyIdentity(report, remote, repository, workflow);
  const latest = await gh([
    'api',
    `repos/${report.repository}/actions/workflows/${remote.workflow_id}/runs?branch=${encodeURIComponent(repository.default_branch)}&per_page=100`,
  ]);
  if (
    !Array.isArray(latest.workflow_runs) ||
    latest.workflow_runs.some((candidate) => newer(candidate, remote))
  )
    throw new Error('Report is stale relative to a newer trusted workflow run.');
  const artifactUrl = await verifyArtifact(report, { artifactName, filename }, run, cwd);
  return { gh, artifactUrl, runStartedAt: remote.run_started_at ?? remote.created_at };
}
