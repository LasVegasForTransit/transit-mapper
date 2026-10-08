import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { execute } from '../audit/index.mjs';
import { idNumber, successful, verifiedRun } from './trusted-report.mjs';
import { applyRecurring } from './recurring-apply.mjs';
import { ownershipLabel, foreignOwnership } from './ownership.mjs';
import { latestIssueEvidence } from './issue-evidence.mjs';
import { verifyExecutor, verifySourceConfiguration } from './trusted-configuration.mjs';

const helper = new URL(
  '../../../plugins/lvbt-contributions/scripts/github-create.mjs',
  import.meta.url,
).pathname;
const slug = /^[a-z0-9][a-z0-9-]*$/;
const normalize = (body) => body.replaceAll('\r\n', '\n').trimEnd();
export function recurringLabels(key, declaration) {
  return [
    ...new Set([
      declaration.type === 'bug' ? 'bug' : 'enhancement',
      'recurring-owned',
      `recurring:${key}`,
      ...declaration.labels,
    ]),
  ];
}
function validLabels(labels) {
  return (
    Array.isArray(labels) &&
    labels.every(
      (label) =>
        typeof label === 'string' &&
        /^[A-Za-z0-9][A-Za-z0-9 .:_-]{0,49}$/.test(label) &&
        !ownershipLabel(label),
    )
  );
}
function validateDeclaration(key, item) {
  const allowed = ['workflow', 'artifactName', 'title', 'type', 'labels', 'pin', 'adoptExisting'];
  if (!item || typeof item !== 'object')
    throw new Error(`Invalid recurring contribution declaration: ${key}.`);
  const valid = [
    slug.test(key),
    Object.keys(item).every((field) => allowed.includes(field)),
    /^\.github\/workflows\/[a-z0-9-]+\.ya?ml$/.test(item.workflow),
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.artifactName),
    typeof item.title === 'string' &&
      Boolean(item.title.trim()) &&
      item.title === item.title.trim(),
    ['bug', 'feature'].includes(item.type),
    validLabels(item.labels),
    item.pin === undefined || typeof item.pin === 'boolean',
    item.adoptExisting === undefined || typeof item.adoptExisting === 'boolean',
  ];
  if (valid.includes(false)) throw new Error(`Invalid recurring contribution declaration: ${key}.`);
}
function declarations(config, workflow) {
  const values = config.contributions?.recurring;
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new Error('Configure contributions.recurring in .lvbt/tooling.json.');
  for (const [key, item] of Object.entries(values)) validateDeclaration(key, item);
  const matching = Object.values(values).filter((item) => item.workflow === workflow);
  if (!matching.length || new Set(matching.map((item) => item.artifactName)).size !== 1)
    throw new Error('Recurring workflow requires one declared evidence artifact.');
  return { values, artifactName: matching[0].artifactName };
}
function validateResult(result, keys) {
  const bodyRequired = ['open', 'resolved'].includes(result.status);
  if (
    !slug.test(result.key) ||
    keys.has(result.key) ||
    !['open', 'resolved', 'error', 'skipped'].includes(result.status) ||
    (bodyRequired && (typeof result.body !== 'string' || !result.body.trim()))
  )
    throw new Error('Invalid or duplicate recurring contribution action.');
  keys.add(result.key);
}
function validate(report) {
  const run = report.run;
  if (
    report.version !== 1 ||
    !/^[\w.-]+\/[\w.-]+$/.test(report.repository ?? '') ||
    !/^[a-f0-9]{40}$/.test(report.commit ?? '') ||
    !run ||
    !/^\d+$/.test(String(run.id)) ||
    !Number.isSafeInteger(run.attempt) ||
    run.attempt < 1 ||
    !Array.isArray(report.results)
  )
    throw new Error('Recurring contribution actions require valid trusted workflow provenance.');
  const keys = new Set();
  for (const result of report.results) validateResult(result, keys);
}
function legacyIssue(issues, declaration, runStartedAt) {
  if (!declaration.adoptExisting) return undefined;
  if (!declaration.labels.length)
    throw new Error('Legacy adoption requires configured ownership labels.');
  const matches = issues.filter(
    (issue) =>
      !issue.pull_request &&
      issue.title === declaration.title &&
      declaration.labels.every((name) =>
        issue.labels?.some((label) => label.name.toLowerCase() === name.toLowerCase()),
      ),
  );
  if (matches.length > 1)
    throw new Error('Multiple legacy issues match the recurring declaration.');
  const issue = matches[0];
  if (!issue) return undefined;
  if (foreignOwnership(issue.labels, []))
    throw new Error('Legacy issue has other automation ownership.');
  if (
    issue.author?.is_bot !== true ||
    !['github-actions', 'github-actions[bot]'].includes(issue.author.login)
  )
    throw new Error('Legacy adoption requires verified GitHub Actions bot authorship.');
  const updated = Date.parse(issue.updatedAt);
  const started = Date.parse(runStartedAt);
  if (!Number.isFinite(updated) || !Number.isFinite(started) || updated > started)
    throw new Error('Legacy adoption is stale or its update time cannot be verified.');
  return issue;
}
function ownedIssue(issues, key, context) {
  const { report, declaration, runStartedAt } = context;
  const matches = issues.filter(
    (issue) =>
      !issue.pull_request &&
      ['recurring-owned', `recurring:${key}`].every((name) =>
        issue.labels?.some((label) => label.name.toLowerCase() === name),
      ),
  );
  if (matches.length > 1) throw new Error(`Multiple recurring-owned issues match ${key}.`);
  const issue = matches[0] ?? legacyIssue(issues, declaration, runStartedAt);
  if (issue && foreignOwnership(issue.labels, ['recurring-owned', `recurring:${key}`]))
    throw new Error('Recurring issue has ambiguous foreign automation ownership.');
  const previous = latestIssueEvidence(issue?.body);
  if (
    previous &&
    (idNumber(previous[1]) > idNumber(report.run.id) ||
      (previous[1] === String(report.run.id) && Number(previous[2]) > report.run.attempt))
  )
    throw new Error('Recurring action is stale relative to the issue evidence.');
  return issue;
}
function lifecycleAction(status, issue) {
  if (status === 'resolved') return 'close';
  if (!issue) return 'create';
  return issue.state === 'CLOSED' ? 'reopen' : 'update';
}
function actionsFor(report, values, issues, evidence) {
  if (!Array.isArray(issues) || issues.length >= 1000)
    throw new Error('Recurring issue inventory is invalid or truncated.');
  const actions = [];
  for (const result of report.results) {
    const declaration = values[result.key];
    if (!declaration || declaration.workflow !== report.run.workflow)
      throw new Error(`Undeclared recurring contribution: ${result.key}.`);
    if (['error', 'skipped'].includes(result.status)) continue;
    const issue = ownedIssue(issues, result.key, {
      report,
      declaration,
      runStartedAt: evidence.runStartedAt,
    });
    if (result.status === 'resolved' && (!issue || issue.state === 'CLOSED')) continue;
    actions.push({
      key: result.key,
      action: lifecycleAction(result.status, issue),
      type: declaration.type,
      title: declaration.title,
      body: `${normalize(result.body)}\n\nContribution owner: LVBT recurring ${result.key} automation.\n\nVerified run: ${report.run.id} (attempt ${report.run.attempt}).\n\nWorkflow: [${report.run.workflow}](${report.run.url}).\n\nCommit: [${report.commit}](https://github.com/${report.repository}/commit/${report.commit}).\n\nEvidence: [Download the verified contribution actions](${evidence.artifactUrl}).\n`,
      labels: recurringLabels(result.key, declaration),
      pin: declaration.pin === true && result.status === 'open',
      ...(issue ? { number: issue.number, url: issue.url } : {}),
    });
  }
  return actions;
}
export function helperArguments(action, repository, file) {
  return [
    helper,
    'issue',
    '--type',
    action.type,
    '--title',
    action.title,
    '--body-file',
    file,
    '--repo',
    repository,
    '--recurring-key',
    action.key,
    '--recurring-labels',
    JSON.stringify(action.labels.slice(3)),
    '--json',
  ];
}
export async function reportRecurring({
  cwd,
  input,
  dryRun = false,
  config,
  environment = process.env,
  execute: run = execute,
}) {
  if (!input) throw new Error('Recurring reporting requires --input.');
  if (!config) {
    const { readTooling } = await import('../tooling.mjs');
    config = await readTooling(cwd);
  }
  const report = JSON.parse(await readFile(path.resolve(cwd, input), 'utf8'));
  validate(report);
  verifyExecutor(report, environment, dryRun);
  const { values, artifactName } = declarations(config, report.run.workflow);
  const evidence = await verifiedRun({
    report,
    workflow: report.run.workflow,
    artifactName,
    filename: 'lvbt-recurring-issues.json',
    run,
    cwd,
  });
  const { gh } = evidence;
  await verifySourceConfiguration(report, config, gh, 'contributions');
  const issues = await gh([
    'issue',
    'list',
    '--repo',
    report.repository,
    '--state',
    'all',
    ...(!Object.values(values).some((item) => item.adoptExisting)
      ? ['--label', 'recurring-owned']
      : []),
    '--limit',
    '1000',
    '--json',
    'number,title,body,state,labels,url,author,updatedAt',
  ]);
  const actions = actionsFor(report, values, issues, evidence);
  const preview = { valid: true, dryRun, repository: report.repository, run: report.run, actions };
  const directory = await mkdtemp(path.join(tmpdir(), 'lvbt-recurring-actions-'));
  try {
    for (const action of actions) {
      const file = path.join(directory, `${action.key}.md`);
      await writeFile(file, action.body);
      const checked = JSON.parse(
        await successful(
          run,
          process.execPath,
          [...helperArguments(action, report.repository, file), '--dry-run'],
          { cwd, message: 'Recurring contribution preview failed.' },
        ),
      );
      if (
        checked.title !== action.title ||
        normalize(checked.body) !== normalize(action.body) ||
        !isDeepStrictEqual(checked.labels, action.labels)
      )
        throw new Error('Contribution helper preview differs from the recurring action.');
    }
    if (!dryRun && actions.length)
      await applyRecurring(actions, report.repository, directory, { run, gh, cwd });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return preview;
}
