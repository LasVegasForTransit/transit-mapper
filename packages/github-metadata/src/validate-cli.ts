#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { validateGitHubEvent } from './event-validation.js';
import {
  type MetadataInput,
  type MetadataKind,
  type ValidationResult,
  validateMetadata,
} from './validation.js';

interface ValidateCliResult {
  exitCode: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

interface EventArguments {
  mode: 'event';
  path: string;
  json: boolean;
}

interface PayloadArguments {
  mode: 'payload';
  path: string;
  kind: MetadataKind;
  json: boolean;
}

type ParsedArguments = EventArguments | PayloadArguments;

type ReadText = (path: string) => Promise<string>;

function usage(message?: string): ValidateCliResult {
  const detail = message ? `${message}\n\n` : '';
  return {
    exitCode: 2,
    stdout: '',
    stderr: `${detail}Usage: github:validate (--event <event-json> | --kind issue|pull-request --input <payload-json>) [--json]\n`,
  };
}

function parseArguments(args: string[]): ParsedArguments | ValidateCliResult {
  let eventPath: string | undefined;
  let inputPath: string | undefined;
  let kind: MetadataKind | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json') {
      json = true;
    } else if (argument === '--event') {
      eventPath = args[index + 1];
      index += 1;
    } else if (argument === '--input') {
      inputPath = args[index + 1];
      index += 1;
    } else if (argument === '--kind') {
      const value = args[index + 1];
      if (value === 'issue' || value === 'pull-request') kind = value;
      else return usage('--kind must be issue or pull-request.');
      index += 1;
    } else {
      return usage(`Unknown argument: ${argument}`);
    }
  }

  if (eventPath && !inputPath && !kind) return { mode: 'event', path: eventPath, json };
  if (!eventPath && inputPath && kind) return { mode: 'payload', path: inputPath, kind, json };
  return usage('Choose exactly one validation mode.');
}

function isCliResult(value: ParsedArguments | ValidateCliResult): value is ValidateCliResult {
  return 'exitCode' in value;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function payloadInput(kind: MetadataKind, value: unknown): MetadataInput | undefined {
  const payload = objectValue(value);
  if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string')
    return undefined;
  return {
    kind,
    title: payload.title,
    body: payload.body,
    actor: typeof payload.actor === 'string' ? payload.actor : undefined,
    headBranch: typeof payload.headBranch === 'string' ? payload.headBranch : undefined,
    draft: payload.draft === true,
  };
}

function renderResult(result: ValidationResult, json: boolean): string {
  if (json) return `${JSON.stringify(result)}\n`;
  if (result.valid) return 'Contribution metadata is valid.\n';
  return `Contribution metadata is invalid:\n${result.errors
    .map((item) => `- ${item.field}: ${item.message}`)
    .join('\n')}\n`;
}

export async function runValidateCli(
  args: string[],
  readText: ReadText,
): Promise<ValidateCliResult> {
  const parsed = parseArguments(args);
  if (isCliResult(parsed)) return parsed;

  let value: unknown;
  try {
    value = JSON.parse(await readText(parsed.path));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return { exitCode: 2, stdout: '', stderr: `Could not parse ${parsed.path}: ${message}\n` };
  }

  let result: ValidationResult;
  if (parsed.mode === 'event') {
    const event = objectValue(value);
    if (!event) return usage('The event JSON must contain an object.');
    result = validateGitHubEvent(event);
  } else {
    const input = payloadInput(parsed.kind, value);
    if (!input) return usage('The payload JSON must contain string title and body values.');
    result = validateMetadata(input);
  }

  return {
    exitCode: result.valid ? 0 : 1,
    stdout: renderResult(result, parsed.json),
    stderr: '',
  };
}

async function main(): Promise<void> {
  const result = await runValidateCli(process.argv.slice(2), (path) => readFile(path, 'utf8'));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
