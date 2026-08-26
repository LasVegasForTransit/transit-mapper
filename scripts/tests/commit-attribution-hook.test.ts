import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface HookResult {
  status: number | null;
  output: string;
}

const repositoryRoot = resolve(import.meta.dirname, '../..');
const temporaryDirectories: string[] = [];

function validateCommitMessage(message: string): HookResult {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'transitmapper-commit-message-'));
  temporaryDirectories.push(fixtureRoot);
  const messagePath = join(fixtureRoot, 'message');
  writeFileSync(messagePath, message);
  const result = spawnSync(resolve(repositoryRoot, '.githooks/commit-msg'), [messagePath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('commit attribution', () => {
  it('rejects an undeclared OpenAI attribution address', () => {
    const result = validateCommitMessage(
      'chore(dx): Reject invalid agent attribution\n\n' +
        'Co-Authored-By: OpenAI <support@openai.com>\n',
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('undeclared OpenAI attribution address');
  });

  it('accepts the repository Codex attribution address', () => {
    const result = validateCommitMessage(
      'chore(dx): Accept declared agent attribution\n\n' +
        'Co-Authored-By: Codex <noreply@openai.com>\n',
    );

    expect(result.status, result.output).toBe(0);
  });
});
