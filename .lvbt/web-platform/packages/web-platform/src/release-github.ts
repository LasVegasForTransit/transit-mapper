import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export async function github(args: string[]): Promise<string> {
  const { stdout } = await execute('gh', args, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}
export async function githubJson(args: string[]): Promise<unknown> {
  return JSON.parse(await github(args));
}
