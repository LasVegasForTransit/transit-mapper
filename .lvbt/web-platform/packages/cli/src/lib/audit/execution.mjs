const measurement = 'Execute configured audits and retain every result';
const retained = 'Retain normalized and raw evidence';
const optional = new Set([
  'Install product audit browser',
  'Build local audit inputs',
  'Install pinned link checker',
]);
function complete(step, conclusions) {
  return step?.status === 'completed' && conclusions.includes(step.conclusion);
}
function oneStep(steps, name) {
  const matches = steps.filter((step) => step.name === name);
  if (matches.length !== 1)
    throw new Error('Audit execution step evidence is missing or ambiguous.');
  return matches[0];
}

function selectedJob(response) {
  if (
    !Array.isArray(response.jobs) ||
    !Number.isSafeInteger(response.total_count) ||
    response.total_count !== response.jobs.length ||
    response.total_count >= 100
  )
    throw new Error('Audit execution job evidence is missing or truncated.');
  const matches = response.jobs.filter((job) =>
    job.steps?.some((step) => step.name === measurement),
  );
  if (matches.length !== 1)
    throw new Error('Audit execution job evidence is missing or ambiguous.');
  return matches[0];
}
function verifyJobIdentity(job, report) {
  if (
    String(job.run_id) !== String(report.run.id) ||
    job.head_sha !== report.commit ||
    job.status !== 'completed' ||
    !['success', 'failure'].includes(job.conclusion)
  )
    throw new Error('Audit execution does not match the completed source run.');
}
function verifyPrerequisites(steps, command) {
  for (const name of ['Checkout executed source', 'Setup Node + pnpm']) {
    const step = oneStep(steps, name);
    if (step.number >= command.number || !complete(step, ['success']))
      throw new Error('Audit execution prerequisite did not succeed.');
  }
  for (const step of steps.filter((step) => step.number < command.number)) {
    if (!complete(step, optional.has(step.name) ? ['success', 'skipped'] : ['success']))
      throw new Error('Audit execution prerequisite did not succeed.');
  }
}
function verifySteps(job, report) {
  const numbers = job.steps.map((step) => step.number);
  if (
    numbers.some((number) => !Number.isSafeInteger(number) || number < 1) ||
    new Set(numbers).size !== numbers.length
  )
    throw new Error('Audit execution step ordering is invalid.');
  const command = oneStep(job.steps, measurement);
  const artifact = oneStep(job.steps, retained);
  if (
    !complete(command, ['success', 'failure']) ||
    !complete(artifact, ['success']) ||
    artifact.number <= command.number
  )
    throw new Error('Audit execution or retained evidence did not complete.');
  const failed = report.results.some((result) => result.status !== 'pass');
  if (command.conclusion !== (failed ? 'failure' : 'success'))
    throw new Error('Audit execution conclusion disagrees with the retained results.');
  verifyPrerequisites(job.steps, command);
}
/** Findings may fail the audit command; failed prerequisites cannot establish passing evidence. */
export async function verifyAuditExecution(report, gh) {
  const response = await gh([
    'api',
    `repos/${report.repository}/actions/runs/${report.run.id}/attempts/${report.run.attempt}/jobs?per_page=100`,
  ]);
  const job = selectedJob(response);
  verifyJobIdentity(job, report);
  verifySteps(job, report);
}
