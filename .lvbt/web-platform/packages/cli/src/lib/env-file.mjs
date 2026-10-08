import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const separator = trimmed.indexOf('=');
  if (separator === -1) return null;
  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    value = value.slice(1, -1);
  return { key, value };
}

/** Read local values without changing their file or the process environment. */
export function parseEnvFile(filePath) {
  const entries = new Map();
  if (!existsSync(filePath)) return entries;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const entry = parseLine(line);
    if (entry) entries.set(entry.key, entry.value);
  }
  return entries;
}

function quoteEnvValue(value) {
  return /[\s"'#]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/** Update only named values, preserving unrelated lines and no-op writes. */
export function mergeEnvFile(filePath, updates) {
  const exists = existsSync(filePath);
  const content = exists ? readFileSync(filePath, 'utf8') : '';
  const keys = new Set();
  const lines = content.split('\n').map((line) => {
    const entry = parseLine(line);
    if (!entry) return line;
    keys.add(entry.key);
    const value = updates.get(entry.key);
    return value === undefined || value === entry.value
      ? line
      : `${entry.key}=${quoteEnvValue(value)}`;
  });
  for (const [key, value] of updates)
    if (!keys.has(key)) lines.push(`${key}=${quoteEnvValue(value)}`);
  const next = lines.join('\n');
  if (exists && next === content) return false;
  writeFileSync(filePath, next);
  try {
    chmodSync(filePath, 0o600);
  } catch {
    /* Filesystems without POSIX modes can still keep local configuration. */
  }
  return true;
}

/** Fill missing environment values; explicit shell overrides always win. */
export function loadEnvFile(filePath, environment = process.env) {
  for (const [key, value] of parseEnvFile(filePath))
    if (environment[key] === undefined) environment[key] = value;
}

export function loadEnvLocal(projectRoot, environment = process.env) {
  loadEnvFile(path.join(projectRoot, '.env.local'), environment);
}
