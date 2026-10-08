import { constants, copyFileSync, chmodSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { CliError } from './arguments.mjs';
import { readTooling } from './tooling.mjs';
import { parseEnvFile } from './env-file.mjs';

function inside(cwd, file) {
  const root = realpathSync(cwd);
  const location = path.resolve(cwd, file);
  const actual = realpathSync(existsSync(location) ? location : path.dirname(location));
  const relative = path.relative(root, actual);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new CliError('Local environment paths must stay inside the repository.', 2);
  return location;
}
export function localEnvironment(cwd, { apply = false } = {}) {
  const config = readTooling(cwd).local ?? {};
  const findings = [];
  const values = new Map();
  for (const entry of config.env ?? []) {
    const example = inside(cwd, entry.example);
    const file = inside(cwd, entry.file);
    if (!existsSync(example)) {
      findings.push({
        ok: false,
        label: 'local environment',
        detail: `${entry.example} is missing`,
        fix: `restore ${entry.example}`,
      });
      continue;
    }
    if (!existsSync(file) && apply) {
      copyFileSync(example, file, constants.COPYFILE_EXCL);
      chmodSync(file, 0o600);
    }
    if (!existsSync(file)) {
      findings.push({
        ok: false,
        label: 'local environment',
        detail: `${entry.file} is missing`,
        fix: 'pnpm bootstrap',
      });
      continue;
    }
    findings.push({ ok: true, label: 'local environment', detail: `${entry.file} is ready` });
    for (const [name, value] of parseEnvFile(file)) values.set(name, value);
  }
  findings.push(...optionalFindings(config.optional ?? [], values));
  return findings;
}

function optionalFindings(optional, values) {
  const findings = [];
  for (const entry of optional) {
    const value = process.env[entry.name] ?? values.get(entry.name);
    if (!value || /PLACEHOLDER/.test(value))
      findings.push({
        ok: true,
        warning: true,
        label: 'integration',
        detail: `${entry.purpose}: optional local configuration is missing (${entry.name})`,
        fix: 'Configure the integration when working on that feature; page development can continue.',
      });
  }
  return findings;
}
