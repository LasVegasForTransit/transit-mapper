import { describe, expect, it } from 'vitest';

import { runCreateIssueCli } from '../src/create-issue-cli.js';
import { runCreatePullRequestCli } from '../src/create-pr-cli.js';

const issuePayload = {
  template: 'bug',
  title: 'File menu does not open',
  sections: {
    reproduction: 'Open the File menu from the upper application toolbar.',
    expected: 'The menu opens and its actions can be selected normally.',
    actual: 'The trigger does not react to either a pointer or the keyboard.',
    evidence: '',
  },
};

const pullRequestPayload = {
  title: 'fix(ui): restore menu activation',
  sections: {
    summary: 'Restore pointer and keyboard activation for every shared menu trigger.',
    reason: 'A global closed-state selector also matched controls that were not surfaces.',
    verification: 'Ran pnpm check and exercised the affected menus at both layout widths.',
    followups: '',
  },
  draft: false,
};

interface IssuePreview {
  body: string;
  label: string;
}

function issuePreview(output: string): IssuePreview {
  const value: unknown = JSON.parse(output);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('body' in value) ||
    typeof value.body !== 'string' ||
    !('label' in value) ||
    typeof value.label !== 'string'
  ) {
    throw new Error('expected an issue preview');
  }
  return { body: value.body, label: value.label };
}

describe('GitHub creation wrappers', () => {
  it('renders and validates a bug payload without writing during a dry run', async () => {
    const result = await runCreateIssueCli(
      ['--input', 'issue.json', '--dry-run', '--json'],
      () => Promise.resolve(JSON.stringify(issuePayload)),
      () => Promise.reject(new Error('dry-run must not invoke a command')),
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: true,
      dryRun: true,
      title: issuePayload.title,
      label: 'bug',
    });
    expect(issuePreview(result.stdout).body).toContain('<!-- transitmapper:reproduction:start -->');
  });

  it('applies the fixed enhancement label for idea payloads', async () => {
    const payload = {
      template: 'idea',
      title: 'Compare network frequency',
      sections: {
        goal: 'Let riders compare the service frequency of two saved networks.',
        'current-blocker': 'The editor currently shows only one simulation timeline.',
        examples: '',
      },
    };
    const result = await runCreateIssueCli(
      ['--input', 'issue.json', '--dry-run', '--json'],
      () => Promise.resolve(JSON.stringify(payload)),
      () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    );

    expect(issuePreview(result.stdout).label).toBe('enhancement');
  });

  it('rejects an invalid issue before invoking GitHub', async () => {
    let invoked = false;
    const result = await runCreateIssueCli(
      ['--input', 'issue.json', '--json'],
      () => Promise.resolve(JSON.stringify({ ...issuePayload, title: 'Bug report' })),
      () => {
        invoked = true;
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
      },
    );

    expect(result.exitCode).toBe(1);
    expect(invoked).toBe(false);
  });

  it('re-fetches and validates the issue GitHub stored', async () => {
    const commands: string[][] = [];
    const result = await runCreateIssueCli(
      ['--input', 'issue.json', '--json'],
      () => Promise.resolve(JSON.stringify(issuePayload)),
      (command, args) => {
        commands.push([command, ...args]);
        if (args.includes('create')) {
          return Promise.resolve({
            exitCode: 0,
            stdout: 'https://github.com/LasVegasForTransit/transit-mapper/issues/101\n',
            stderr: '',
          });
        }
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({
            number: 101,
            url: 'https://github.com/LasVegasForTransit/transit-mapper/issues/101',
            title: issuePayload.title,
            body: '<!-- transitmapper:issue:bug -->\n\n<!-- transitmapper:reproduction:start -->\nOpen the File menu from the upper application toolbar.\n<!-- transitmapper:reproduction:end -->\n\n<!-- transitmapper:expected:start -->\nThe menu opens and its actions can be selected normally.\n<!-- transitmapper:expected:end -->\n\n<!-- transitmapper:actual:start -->\nThe trigger does not react to either a pointer or the keyboard.\n<!-- transitmapper:actual:end -->\n\n<!-- transitmapper:evidence:start -->\n<!-- transitmapper:evidence:end -->\n',
            labels: [{ name: 'bug' }],
          }),
          stderr: '',
        });
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"number":101');
    expect(commands.map((command) => command.slice(0, 3))).toEqual([
      ['gh', 'issue', 'create'],
      ['gh', 'issue', 'view'],
    ]);
  });

  it('uses the pushed current branch and main base for a pull request dry run', async () => {
    const commands: string[][] = [];
    const result = await runCreatePullRequestCli(
      ['--input', 'pr.json', '--dry-run', '--json'],
      () => Promise.resolve(JSON.stringify(pullRequestPayload)),
      (command, args) => {
        commands.push([command, ...args]);
        if (args.includes('--show-current')) {
          return Promise.resolve({ exitCode: 0, stdout: 'codex/restore-menus\n', stderr: '' });
        }
        if (args.includes('--symbolic-full-name')) {
          return Promise.resolve({
            exitCode: 0,
            stdout: 'origin/codex/restore-menus\n',
            stderr: '',
          });
        }
        return Promise.resolve({ exitCode: 0, stdout: '0\n', stderr: '' });
      },
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: true,
      dryRun: true,
      head: 'codex/restore-menus',
      base: 'main',
      draft: false,
    });
    expect(commands.every(([command]) => command === 'git')).toBe(true);
  });

  it('re-fetches and validates the pull request GitHub stored', async () => {
    const commands: string[][] = [];
    let createdBody = '';
    const result = await runCreatePullRequestCli(
      ['--input', 'pr.json', '--json'],
      () => Promise.resolve(JSON.stringify(pullRequestPayload)),
      (command, args, stdin) => {
        commands.push([command, ...args]);
        if (command === 'git' && args.includes('--show-current')) {
          return Promise.resolve({ exitCode: 0, stdout: 'codex/restore-menus\n', stderr: '' });
        }
        if (command === 'git' && args.includes('--symbolic-full-name')) {
          return Promise.resolve({
            exitCode: 0,
            stdout: 'origin/codex/restore-menus\n',
            stderr: '',
          });
        }
        if (command === 'git') {
          return Promise.resolve({ exitCode: 0, stdout: '0\n', stderr: '' });
        }
        if (args.includes('create')) {
          createdBody = stdin ?? '';
          return Promise.resolve({
            exitCode: 0,
            stdout: 'https://github.com/LasVegasForTransit/transit-mapper/pull/102\n',
            stderr: '',
          });
        }
        return Promise.resolve({
          exitCode: 0,
          stdout: JSON.stringify({
            number: 102,
            url: 'https://github.com/LasVegasForTransit/transit-mapper/pull/102',
            title: pullRequestPayload.title,
            body: createdBody,
            isDraft: false,
            headRefName: 'codex/restore-menus',
          }),
          stderr: '',
        });
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"number":102');
    expect(commands.some((command) => command.join(' ').includes('pr view 102'))).toBe(true);
  });
});
