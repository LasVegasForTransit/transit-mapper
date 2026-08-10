#!/usr/bin/env tsx
/**
 * Keeps the GitHub workflow's externally reported status aligned with the
 * governance data that eventually makes that status a merge requirement.
 *
 * Workflow YAML cannot import TypeScript. This check is the bridge across
 * that format boundary, so a spelling change cannot create a required status
 * that no workflow ever reports.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Import the status through the governance standard so TypeScript proves that
// the workflow checker and the validator use the same canonical contract.
import {
  CONTRIBUTION_METADATA_STATUS as GOVERNANCE_STATUS,
  REQUIRED_STATUS_CHECKS,
} from './bootstrap/standards.ts';

const ROOT = resolve(import.meta.dirname, '..');
const workflow = await readFile(
  resolve(ROOT, '.github/workflows/contribution-metadata.yml'),
  'utf8',
);

const errors: string[] = [];
if (!workflow.includes(`STATUS_CONTEXT: ${GOVERNANCE_STATUS}`)) {
  errors.push(`the pull request workflow does not publish the ${GOVERNANCE_STATUS} status`);
}
if (workflow.includes('ref: ${{ github.event.pull_request.head')) {
  errors.push('the pull_request_target workflow checks out the untrusted pull request head');
}

const requiredNames: readonly string[] = REQUIRED_STATUS_CHECKS.map((check) => check.context);
if (requiredNames.includes(GOVERNANCE_STATUS) && !workflow.includes('pull_request_target:')) {
  errors.push(
    `the governance standard requires ${GOVERNANCE_STATUS}, but its workflow has no pull_request_target trigger`,
  );
}

if (errors.length > 0) {
  console.error(
    `GitHub metadata contract failed:\n${errors.map((message) => `  - ${message}`).join('\n')}`,
  );
  process.exit(1);
}

console.log(
  `GitHub metadata contract: ${GOVERNANCE_STATUS} is published by trusted default-branch code.`,
);
