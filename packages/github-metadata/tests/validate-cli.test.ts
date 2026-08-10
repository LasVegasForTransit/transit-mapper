import { describe, expect, it } from 'vitest';

import { runValidateCli } from '../src/validate-cli.js';
import { renderIssueBody } from '../src/validation.js';

const validIssue = {
  title: 'File menu does not open',
  body: renderIssueBody({
    template: 'bug',
    sections: {
      reproduction: 'Open the File menu from the upper application toolbar.',
      expected: 'The menu opens and its actions can be selected normally.',
      actual: 'The trigger does not react to either a pointer or the keyboard.',
      evidence: '',
    },
  }),
};

describe('github:validate command', () => {
  it('validates a payload file and emits the stable JSON result', async () => {
    const result = await runValidateCli(
      ['--kind', 'issue', '--input', 'issue.json', '--json'],
      () => Promise.resolve(JSON.stringify(validIssue)),
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: '{"valid":true,"errors":[]}\n',
      stderr: '',
    });
  });

  it('returns exit code 1 for a policy failure', async () => {
    const result = await runValidateCli(
      ['--kind', 'issue', '--input', 'issue.json', '--json'],
      () => Promise.resolve(JSON.stringify({ ...validIssue, title: 'Bug report' })),
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: false,
      errors: [{ code: 'placeholder_title', field: 'title' }],
    });
  });

  it('validates a GitHub event file', async () => {
    const result = await runValidateCli(['--event', 'event.json', '--json'], () =>
      Promise.resolve(JSON.stringify({ issue: validIssue })),
    );

    expect(result.exitCode).toBe(0);
  });

  it('returns exit code 2 for malformed invocation or input', async () => {
    const missingMode = await runValidateCli([], () => Promise.resolve('{}'));
    const malformedJson = await runValidateCli(['--event', 'event.json'], () =>
      Promise.resolve('{'),
    );

    expect(missingMode.exitCode).toBe(2);
    expect(malformedJson.exitCode).toBe(2);
    expect(malformedJson.stderr).toContain('Could not parse');
  });
});
