import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { checks, execute } from './index.mjs';
import {
  verifyExecutor,
  verifySourceConfiguration,
} from '../contributions/trusted-configuration.mjs';
import { foreignOwnership } from '../contributions/ownership.mjs';
import { latestIssueEvidence } from '../contributions/issue-evidence.mjs';
import { idNumber, successful, verifiedRun } from '../contributions/trusted-report.mjs';
import { verifyAuditExecution } from './execution.mjs';
import { applyIssueActions } from '../contributions/issue-apply.mjs';

const helper = new URL(
  '../../../plugins/lvbt-contributions/scripts/github-create.mjs',
  import.meta.url,
).pathname;
const titleNames = { links: 'Links', lighthouse: 'Lighthouse', dependencies: 'Dependency' };
const labelNames = (result) => [
  'bug',
  'audit-owned',
  `audit:${result.check}`,
  `target:${result.target}`,
];
const normalize = (body) => body.replaceAll('\r\n', '\n').trimEnd();

function validateResult(result, report, seen) {
  const key = `${result.check}:${result.target}`;
  const valid = [
    checks.includes(result.check),
    result.target === report.target,
    ['pass', 'fail', 'error', 'skipped'].includes(result.status),
    Array.isArray(result.findings),
    Array.isArray(result.artifacts),
    Array.isArray(result.command),
    !seen.has(key),
  ];
  if (valid.some((value) => !value))
    throw new Error('Audit report contains invalid or duplicate results.');
  if (result.status === 'pass' && result.findings.length)
    throw new Error('Passing audit cannot contain failure findings.');
  if (
    result.status === 'fail' &&
    (!result.findings.length ||
      result.findings.some(
        (finding) => typeof finding.title !== 'string' || typeof finding.diagnostic !== 'string',
      ))
  )
    throw new Error('Failed audit requires concrete findings.');
  seen.add(key);
}
function validate(report) {
  if (!report.run) throw new Error('Audit report has no trusted workflow provenance.');
  const valid = [
    report.version === 1,
    /^[\w.-]+\/[\w.-]+$/.test(report.repository ?? ''),
    /^[a-f\d]{40}$/i.test(report.commit ?? ''),
    /^\d+$/.test(String(report.run.id)),
    Number.isSafeInteger(report.run.attempt),
    report.run.attempt >= 1,
    ['local', 'production'].includes(report.target),
    Array.isArray(report.results),
  ];
  if (valid.some((value) => !value) || !report.results.length)
    throw new Error('Audit report has no valid trusted provenance or results.');
  const seen = new Set();
  for (const result of report.results) validateResult(result, report, seen);
}
function issueBody(report, result) {
  const command = result.command.join(' ');
  const findings = result.findings
    .map(
      (finding) =>
        `- ${finding.title}: ${finding.diagnostic}${finding.location ? ` Location: ${finding.location}.` : ''}${finding.url ? ` See ${finding.url}.` : ''}`,
    )
    .join('\n');
  return `# Steps to reproduce\n\nRun \`${command.replaceAll('`', '\\`')}\` against ${result.target} at commit ${report.commit}.\n\n# Expected behavior\n\nThe ${result.check} audit passes without findings.\n\n# Actual behavior\n\n${result.status === 'pass' ? 'The verified audit now passes.' : findings}\n\n# Additional context\n\nAudit owner: LVBT shared audit automation.\n\nVerified run: ${report.run.id} (attempt ${report.run.attempt}).\n\nWorkflow: [${report.run.workflow}](${report.run.url}).\n\nCommit: [${report.commit}](https://github.com/${report.repository}/commit/${report.commit}).\n\nArtifacts: [Download the verified audit evidence](${report.artifactUrl}).${result.artifacts.length ? ` Raw files: ${result.artifacts.join(', ')}.` : ''}\n`;
}
function ownedIssue(issues, labels, result, report) {
  const matches = issues.filter(
    (issue) =>
      !issue.pull_request &&
      labels
        .slice(1)
        .every((name) => issue.labels.some((label) => label.name.toLowerCase() === name)),
  );
  if (matches.length > 1)
    throw new Error(`Multiple audit-owned issues match ${result.check}/${result.target}.`);
  const issue = matches[0];
  if (!issue) return undefined;
  if (foreignOwnership(issue.labels, labels.slice(1)))
    throw new Error('Audit issue has ambiguous foreign automation ownership.');
  const previous = latestIssueEvidence(issue.body);
  if (
    previous &&
    (idNumber(previous[1]) > idNumber(report.run.id) ||
      (previous[1] === String(report.run.id) && Number(previous[2]) > report.run.attempt))
  )
    throw new Error('Audit result is stale relative to the issue evidence.');
  return issue;
}
function lifecycleAction(result, issue) {
  if (result.status === 'pass') return 'close';
  if (!issue) return 'create';
  return issue.state === 'CLOSED' ? 'reopen' : 'update';
}
function actionsFor(report, issues) {
  if (!Array.isArray(issues)) throw new Error('GitHub returned invalid issue data.');
  if (issues.length >= 1000)
    throw new Error('Audit-owned issue search is truncated; refusing ambiguous updates.');
  const actions = [];
  for (const result of report.results) {
    if (!['pass', 'fail'].includes(result.status)) continue;
    const labels = labelNames(result);
    const issue = ownedIssue(issues, labels, result, report);
    if (result.status === 'pass' && (!issue || issue.state === 'CLOSED')) continue;
    actions.push({
      action: lifecycleAction(result, issue),
      check: result.check,
      target: result.target,
      title: `${titleNames[result.check]} audit fails in ${result.target}`,
      body: issueBody(report, result),
      labels,
      ...(issue ? { number: issue.number, url: issue.url } : {}),
    });
  }
  return actions;
}
const bodyFile = (directory, action) => path.join(directory, `${action.check}-${action.target}.md`);
function helperArguments(action, report, file) {
  return [
    helper,
    'issue',
    '--type',
    'bug',
    '--title',
    action.title,
    '--body-file',
    file,
    '--repo',
    report.repository,
    '--audit-check',
    action.check,
    '--audit-target',
    action.target,
    '--json',
  ];
}
async function previewActions(actions, report, directory, { run, cwd }) {
  for (const action of actions) {
    const file = bodyFile(directory, action);
    await writeFile(file, action.body);
    const output = await successful(
      run,
      process.execPath,
      [...helperArguments(action, report, file), '--dry-run'],
      { cwd, message: 'Audit contribution preview failed.' },
    );
    const checked = JSON.parse(output);
    if (
      checked.title !== action.title ||
      normalize(checked.body) !== normalize(action.body) ||
      !isDeepStrictEqual(checked.labels, action.labels)
    )
      throw new Error('Contribution helper preview differs from the audit action.');
  }
}
export async function reportAudit({
  cwd,
  input,
  dryRun = false,
  config,
  environment = process.env,
  execute: run = execute,
}) {
  if (!input) throw new Error('Audit reporting requires --input.');
  if (!config) {
    const { readTooling } = await import('../tooling.mjs');
    config = await readTooling(cwd);
  }
  const report = JSON.parse(await readFile(path.resolve(cwd, input), 'utf8'));
  validate(report);
  verifyExecutor(report, environment, dryRun);
  const { gh, artifactUrl } = await verifiedRun({
    report,
    workflow: config.audits?.workflow ?? '.github/workflows/audits.yml',
    artifactName: config.audits?.artifactName ?? 'lvbt-audit-report',
    filename: 'lvbt-audit-report.json',
    run,
    cwd,
  });
  await verifySourceConfiguration(report, config, gh, 'audits');
  await verifyAuditExecution(report, gh);
  const issues = await gh([
    'issue',
    'list',
    '--repo',
    report.repository,
    '--state',
    'all',
    '--label',
    'audit-owned',
    '--limit',
    '1000',
    '--json',
    'number,title,body,state,labels,url',
  ]);
  const actions = actionsFor({ ...report, artifactUrl }, issues);
  const preview = { valid: true, dryRun, repository: report.repository, run: report.run, actions };
  if (!actions.length) return preview;
  const directory = await mkdtemp(path.join(tmpdir(), 'lvbt-audit-issues-'));
  try {
    await previewActions(actions, report, directory, { run, cwd });
    if (!dryRun)
      await applyIssueActions(actions, report.repository, {
        gh,
        run,
        cwd,
        bodyFile: (action) => bodyFile(directory, action),
        helperArguments: (action, repository, file) =>
          helperArguments(action, { repository }, file),
      });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return preview;
}
