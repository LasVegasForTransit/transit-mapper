import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BRANCH_RULESET,
  branchRulesetFor,
  REPOSITORY_MERGE_SETTINGS,
  REQUIRED_STATUS_CHECKS,
} from '../bootstrap/standards.js';

/**
 * The organization's rule is a linear `main`: pull requests land by rebase,
 * never by squash and never with a merge commit. These cases hold the
 * governance standard the bootstrap applies to that rule, and to the checks
 * CI really reports, because a standard that drifted from either would be
 * applied to the live repository by the next `pnpm bootstrap`.
 */

const WORKFLOW_DIR = path.resolve(import.meta.dirname, '../../.github/workflows');

interface WorkflowFacts {
  file: string;
  /** Events under `on:`. */
  triggers: string[];
  /** Each job's `name:`, which is the status check context it reports. */
  jobNames: string[];
}

/**
 * Triggers and job names, read from the two fixed indents a workflow uses
 * for them. Enough for this question without a YAML parser: every workflow
 * here is formatted by Prettier, so `on:` keys sit at two spaces and a job's
 * own `name:` at four, below any step's.
 */
function workflowFacts(file: string): WorkflowFacts {
  const lines = readFileSync(path.join(WORKFLOW_DIR, file), 'utf8').split('\n');
  const section = (header: string): string[] => {
    const start = lines.indexOf(header);
    if (start < 0) return [];
    const end = lines.findIndex((line, index) => index > start && /^\S/u.test(line));
    return lines.slice(start + 1, end < 0 ? undefined : end);
  };
  return {
    file,
    triggers: section('on:').flatMap((line) => /^ {2}([a-z_]+):/u.exec(line)?.[1] ?? []),
    jobNames: section('jobs:').flatMap(
      (line) => /^ {4}name: (.+)$/u.exec(line)?.[1]?.replace(/^['"]|['"]$/gu, '') ?? [],
    ),
  };
}

const workflows = readdirSync(WORKFLOW_DIR)
  .filter((file) => /\.ya?ml$/u.test(file))
  .map(workflowFacts);

type Rule = (typeof BRANCH_RULESET)['rules'][number];

function rule<T extends Rule['type']>(type: T): Extract<Rule, { type: T }> | undefined {
  return BRANCH_RULESET.rules.find(
    (candidate): candidate is Extract<Rule, { type: T }> => candidate.type === type,
  );
}

describe('the governance standard', () => {
  it('lets a pull request land on main by rebase only', () => {
    expect(rule('pull_request')?.parameters.allowed_merge_methods).toEqual(['rebase']);
    expect(rule('required_linear_history')).toBeDefined();
  });

  it('has the merge queue land by rebase too', () => {
    expect(rule('merge_queue')?.parameters.merge_method).toBe('REBASE');
  });

  it('turns off the squash and merge-commit buttons and keeps rebase', () => {
    expect(REPOSITORY_MERGE_SETTINGS).toEqual({
      allow_merge_commit: false,
      allow_squash_merge: false,
      allow_rebase_merge: true,
    });
  });

  it('requires only checks CI reports on pull requests and in the merge queue', () => {
    // A required check the merge group never reports leaves every queue entry
    // waiting until it is dropped, so nothing could merge at all.
    const reported = new Set(
      workflows
        .filter((workflow) =>
          ['pull_request', 'merge_group'].every((event) => workflow.triggers.includes(event)),
        )
        .flatMap((workflow) => workflow.jobNames),
    );
    const required = REQUIRED_STATUS_CHECKS.map((check) => check.context);

    expect(required.length).toBeGreaterThan(0);
    expect(required.filter((context) => !reported.has(context))).toEqual([]);
    expect(rule('required_status_checks')?.parameters.required_status_checks).toBe(
      REQUIRED_STATUS_CHECKS,
    );
  });

  it('drops only the merge queue for a repository a person owns', () => {
    const personal = branchRulesetFor(false).rules.map((candidate) => candidate.type);
    const organization = branchRulesetFor(true).rules.map((candidate) => candidate.type);

    expect(organization).toContain('merge_queue');
    expect(personal).toEqual(organization.filter((type) => type !== 'merge_queue'));
  });
});
