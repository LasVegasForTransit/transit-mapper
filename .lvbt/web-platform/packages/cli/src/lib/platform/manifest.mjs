import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from './schema.mjs';

export const MANIFEST_FILE = 'platform.json';
export const SCHEMA_PATH = fileURLToPath(new URL('../../../platform.schema.json', import.meta.url));

let schemaCache;
export function platformSchema() {
  schemaCache ??= JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  return schemaCache;
}

/** platform.json at the root and in each apps/*, as paths relative to `cwd`. */
export function findManifests(cwd) {
  const found = [];
  const isFile = (file) => statSync(file, { throwIfNoEntry: false })?.isFile() === true;
  if (isFile(path.join(cwd, MANIFEST_FILE))) found.push(MANIFEST_FILE);
  let apps = [];
  try {
    apps = readdirSync(path.join(cwd, 'apps'), { withFileTypes: true });
  } catch {
    // A repository without apps/ has only the root to look at.
  }
  for (const entry of apps.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join('apps', entry.name, MANIFEST_FILE);
    if (entry.isDirectory() && isFile(path.join(cwd, file))) found.push(file);
  }
  return found;
}

/** Where the string that opens at `start` closes, counting escapes. */
function stringEnd(text, start) {
  let end = start + 1;
  while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
  return end + 1;
}

/** Where the comment that opens at `start` ends, or `start` when none opens there. */
function commentEnd(text, start) {
  if (text[start] !== '/') return start;
  if (text[start + 1] === '/') {
    const end = text.indexOf('\n', start);
    return end === -1 ? text.length : end;
  }
  if (text[start + 1] === '*') {
    const end = text.indexOf('*/', start + 2);
    return end === -1 ? text.length : end + 2;
  }
  return start;
}

/**
 * JSON with comments and trailing commas, as wrangler.jsonc allows. Strings
 * are copied untouched, so a URL's `//` is not mistaken for a comment.
 */
export function parseJsonc(text) {
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const skipped = commentEnd(text, index);
    if (skipped !== index) index = skipped;
    else if (text[index] === '"') {
      const end = stringEnd(text, index);
      tokens.push(text.slice(index, end));
      index = end;
    } else {
      if (!/\s/.test(text[index])) tokens.push(text[index]);
      index += 1;
    }
  }
  // A comma directly before a closing bracket is the trailing comma JSONC allows.
  const kept = tokens.filter(
    (token, position) => !(token === ',' && ['}', ']'].includes(tokens[position + 1])),
  );
  return JSON.parse(kept.join(''));
}

function names(list) {
  return (list ?? []).map((item) => item.name);
}

function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function duplicateErrors(manifest) {
  const errors = duplicates([...names(manifest.secrets), ...names(manifest.vars)]).map(
    (name) => `${name} is declared more than once across secrets and vars.`,
  );
  for (const label of ['d1', 'r2', 'turnstile', 'access']) {
    for (const name of duplicates(names(manifest[label])))
      errors.push(`${label} "${name}" is declared twice.`);
  }
  return errors;
}

/** Secrets a resource fills in, each with the resource that feeds it. */
export function fedSecrets(manifest) {
  const fed = [];
  for (const widget of manifest.turnstile ?? [])
    fed.push({ name: widget.secret, owner: `turnstile "${widget.name}"` });
  for (const app of manifest.access ?? []) {
    fed.push({ name: app.teamDomainSecret, owner: `access "${app.name}"` });
    fed.push({ name: app.audienceSecret, owner: `access "${app.name}"` });
  }
  return fed;
}

function referenceErrors(manifest) {
  const errors = [];
  const secrets = new Map((manifest.secrets ?? []).map((secret) => [secret.name, secret]));
  const vars = new Set(names(manifest.vars));
  const references = [
    ...fedSecrets(manifest),
    ...(manifest.email ?? [])
      .filter((email) => email.apiKeySecret)
      .map((email) => ({ name: email.apiKeySecret, owner: `email "${email.domain}"` })),
  ];
  for (const { name, owner } of references) {
    const secret = secrets.get(name);
    if (!secret) errors.push(`${owner} feeds ${name}, which is not listed in secrets.`);
    else if (!(secret.targets ?? ['worker']).includes('worker'))
      errors.push(`${owner} feeds ${name}, so ${name} must target the worker.`);
  }
  for (const widget of manifest.turnstile ?? []) {
    if (!vars.has(widget.siteKeyVar))
      errors.push(
        `turnstile "${widget.name}" feeds ${widget.siteKeyVar}, which is not listed in vars.`,
      );
  }
  return errors;
}

function accessErrors(manifest) {
  const errors = [];
  for (const app of manifest.access ?? []) {
    if (Object.keys(app.allow ?? {}).length !== 1)
      errors.push(
        `access "${app.name}" must allow exactly one of googleGroup, emailDomain, emails.`,
      );
    if (app.allow?.googleGroup && app.identityProvider !== 'google-apps')
      errors.push(
        `access "${app.name}" allows a Google group, so identityProvider must be google-apps.`,
      );
  }
  return errors;
}

function validPattern(pattern) {
  try {
    new RegExp(pattern, 'u');
    return true;
  } catch {
    return false;
  }
}

const targetsGithub = (entry) =>
  (entry.targets ?? []).some((target) => target.startsWith('github:'));

function secretErrors(manifest) {
  const errors = [];
  const fed = new Set(fedSecrets(manifest).map((entry) => entry.name));
  for (const secret of manifest.secrets ?? []) {
    const sources = [secret.generate === true, secret.from !== undefined, fed.has(secret.name)];
    const count = sources.filter(Boolean).length;
    if (count > 1)
      errors.push(
        `${secret.name} has more than one source; use only one of generate, from, or a feeding resource.`,
      );
    if (count === 0 && !secret.steps)
      errors.push(
        `${secret.name} is typed in by a person, so it needs steps that say where to find it.`,
      );
    if (secret.sensitive === false && secret.generate)
      errors.push(
        `${secret.name} is generated, which makes it a credential, so it cannot be "sensitive": false.`,
      );
    if (secret.pattern && !validPattern(secret.pattern))
      errors.push(`${secret.name} has a pattern that is not a valid regular expression.`);
    if (targetsGithub(secret) && !manifest.github)
      errors.push(`${secret.name} targets a GitHub environment, so github.repository is required.`);
  }
  return errors;
}

function forbiddenErrors(manifest) {
  const errors = [];
  const declared = new Set([...names(manifest.secrets), ...names(manifest.vars)]);
  for (const entry of manifest.forbidden ?? []) {
    if (declared.has(entry.name)) errors.push(`${entry.name} is both required and forbidden.`);
    if (targetsGithub(entry) && !manifest.github)
      errors.push(
        `forbidden ${entry.name} targets a GitHub environment, so github.repository is required.`,
      );
  }
  return errors;
}

/** The rules a JSON schema cannot express: names that refer to each other, and contradictions. */
function semanticErrors(manifest) {
  return [
    ...duplicateErrors(manifest),
    ...referenceErrors(manifest),
    ...accessErrors(manifest),
    ...secretErrors(manifest),
    ...forbiddenErrors(manifest),
  ];
}

/** Every problem with a parsed manifest, as readable lines. Empty when it is valid. */
export function validateManifest(manifest) {
  const errors = validateAgainstSchema(platformSchema(), manifest);
  return errors.length > 0 ? errors : semanticErrors(manifest);
}

/** Read and validate one manifest. Throws with every problem listed. */
export function loadManifest(file) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`, { cause: error });
  }
  const errors = validateManifest(manifest);
  if (errors.length > 0)
    throw new Error(`${file} is not a valid platform manifest:\n  ${errors.join('\n  ')}`);
  return manifest;
}

/**
 * The parts of the production wrangler config the platform check compares
 * against: the Worker's name, its vars, and its D1 and R2 bindings.
 */
export function readWranglerConfig(file) {
  const config = parseJsonc(readFileSync(file, 'utf8'));
  return {
    name: config.name,
    vars: config.vars ?? {},
    d1: (config.d1_databases ?? []).map((database) => ({
      binding: database.binding,
      name: database.database_name,
      id: database.database_id,
      migrationsTable: database.migrations_table ?? 'd1_migrations',
    })),
    r2: (config.r2_buckets ?? []).map((bucket) => ({
      binding: bucket.binding,
      name: bucket.bucket_name,
    })),
  };
}

/** The .sql files in a migrations directory, in the order Wrangler applies them. */
export function migrationFiles(directory) {
  let files;
  try {
    files = readdirSync(directory);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('the directory does not exist', { cause: error });
    throw error;
  }
  return files.filter((file) => file.endsWith('.sql')).sort();
}
