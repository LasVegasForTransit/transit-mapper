import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from './arguments.mjs';
import { validateAgainstSchema } from './platform/schema.mjs';

const schema = JSON.parse(
  readFileSync(new URL('../../tooling.schema.json', import.meta.url), 'utf8'),
);
export function validateTooling(value) {
  return validateAgainstSchema(schema, value);
}
export function readTooling(cwd) {
  const file = path.join(cwd, '.lvbt/tooling.json');
  if (!existsSync(file)) return { version: 1 };
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new CliError('Invalid .lvbt/tooling.json; restore valid JSON.', 2);
  }
  const errors = validateTooling(config);
  if (errors.length) throw new CliError(`Invalid .lvbt/tooling.json:\n${errors.join('\n')}`, 2);
  return config;
}
