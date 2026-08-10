import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export interface CliResult {
  exitCode: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  stdin?: string,
) => Promise<CommandResult>;
export type ReadText = (path: string) => Promise<string>;

export interface CreateArguments {
  input: string;
  dryRun: boolean;
  json: boolean;
}

export function parseCreateArguments(args: string[], command: string): CreateArguments | CliResult {
  let input: string | undefined;
  let dryRun = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--input') {
      input = args[index + 1];
      index += 1;
    } else if (argument === '--dry-run') {
      dryRun = true;
    } else if (argument === '--json') {
      json = true;
    } else {
      return runtimeFailure(
        `Unknown argument: ${argument}\nUsage: ${command} --input <payload-json> [--dry-run] [--json]`,
      );
    }
  }
  if (!input)
    return runtimeFailure(`Usage: ${command} --input <payload-json> [--dry-run] [--json]`);
  return { input, dryRun, json };
}

export function isCliResult(value: object): value is CliResult {
  return 'exitCode' in value;
}

export function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function readJsonObject(
  path: string,
  readText: ReadText,
): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readText(path));
  const object = objectValue(value);
  if (!object) throw new Error('The payload must contain a JSON object.');
  return object;
}

export function stringSections(value: unknown): Record<string, string> | undefined {
  const sections = objectValue(value);
  if (!sections || Object.values(sections).some((section) => typeof section !== 'string')) {
    return undefined;
  }
  return sections as Record<string, string>;
}

export function runtimeFailure(message: string): CliResult {
  return { exitCode: 2, stdout: '', stderr: `${message}\n` };
}

export function policyFailure(
  errors: Array<{ field: string; message: string }>,
  json: boolean,
): CliResult {
  return {
    exitCode: 1,
    stdout: json ? jsonOutput({ valid: false, errors }) : '',
    stderr: json ? '' : `${errors.map((item) => `${item.field}: ${item.message}`).join('\n')}\n`,
  };
}

export function jsonOutput(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export const defaultReadText: ReadText = (path) => readFile(path, 'utf8');

export const defaultCommandRunner: CommandRunner = (command, args, stdin) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: stdin,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return Promise.resolve({
    exitCode: result.status ?? 2,
    stdout: result.stdout,
    stderr: result.stderr,
  });
};

export function writeCliResult(result: CliResult): void {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
