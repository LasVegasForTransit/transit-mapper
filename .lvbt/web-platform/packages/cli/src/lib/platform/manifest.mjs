import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { secretForTarget, secretTargets, scopedSecretErrors } from './secret-scope.mjs';
import { validateAgainstSchema } from './schema.mjs';
import { cloudflareWorkerBindings, wranglerWorkerBindings } from './worker-bindings.mjs';

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
  const repeated = duplicates(names(manifest.vars));
  repeated.push(...names(manifest.secrets).filter((name) => names(manifest.vars).includes(name)));
  const errors = [...new Set(repeated)].map(
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
  const secrets = new Set(names(manifest.secrets));
  const vars = new Set(names(manifest.vars));
  const references = [
    ...fedSecrets(manifest),
    ...(manifest.email ?? [])
      .filter((email) => email.apiKeySecret)
      .map((email) => ({ name: email.apiKeySecret, owner: `email "${email.domain}"` })),
  ];
  for (const { name, owner } of references) {
    const secret = secretForTarget(manifest, name, 'worker');
    if (!secrets.has(name)) errors.push(`${owner} feeds ${name}, which is not listed in secrets.`);
    else if (!secret) errors.push(`${owner} feeds ${name}, so ${name} must target the worker.`);
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
  const fed = new Set(fedSecrets(manifest).map((entry) => entry.name));
  return (manifest.secrets ?? []).flatMap((secret) => {
    const errors = [];
    if (secret.listOnly && secret.use !== 'future')
      errors.push(`${secret.name} can be listOnly only while its use is future.`);
    const sources = [
      secret.generate === true,
      secret.from !== undefined,
      fed.has(secret.name) && (secret.targets ?? ['worker']).includes('worker'),
    ];
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
    return errors;
  });
}

function forbiddenErrors(manifest) {
  const errors = [];
  const declared = [...(manifest.secrets ?? []), ...(manifest.vars ?? [])];
  for (const entry of manifest.forbidden ?? []) {
    if (
      declared.some(
        (required) =>
          required.name === entry.name &&
          secretTargets(required).some((target) => secretTargets(entry).includes(target)),
      )
    )
      errors.push(`${entry.name} is both required and forbidden.`);
    if (targetsGithub(entry) && !manifest.github)
      errors.push(
        `forbidden ${entry.name} targets a GitHub environment, so github.repository is required.`,
      );
  }
  return errors;
}

function accountErrors(manifest) {
  const { accountId, accountIdEnv } = manifest.cloudflare;
  return (accountId === undefined) === (accountIdEnv === undefined)
    ? ['cloudflare needs exactly one of accountId or accountIdEnv.']
    : [];
}

function zoneErrors(manifest) {
  const { id, idEnv } = manifest.cloudflare.zone;
  return (id === undefined) === (idEnv === undefined)
    ? ['cloudflare.zone needs exactly one of id or idEnv.']
    : [];
}
function resourceBindingErrors(manifest) {
  const entries = ['d1', 'r2', 'analyticsEngine', 'rateLimits'].flatMap((kind) =>
    (manifest[kind] ?? []).map((entry) => `${entry.environment ?? 'production'}:${entry.binding}`),
  );
  return duplicates(entries).map(
    (binding) => `${binding} resource binding is declared more than once.`,
  );
}
/** Resolve only the declared public zone identifier selector before any provider API call. */
export function resolveManifestZone(manifest, env) {
  const name = manifest.cloudflare.zone.idEnv;
  if (!name) return manifest;
  const id = env[name]?.trim();
  if (!/^[0-9a-f]{32}$/.test(id ?? ''))
    throw new Error(`${name} must be set to the Cloudflare zone's 32-character ID.`);
  return {
    ...manifest,
    cloudflare: { ...manifest.cloudflare, zone: { ...manifest.cloudflare.zone, id } },
  };
}

function githubVariableErrors(manifest) {
  const errors = [];
  const scopes = new Set();
  for (const variable of manifest.github?.variables ?? []) {
    const key = `${variable.environment ?? 'repository'}:${variable.name}`;
    if (scopes.has(key))
      errors.push(
        `GitHub variable ${variable.name} is declared twice in ${variable.environment ?? 'repository'}.`,
      );
    scopes.add(key);
    if (variable.value !== undefined && variable.from !== undefined)
      errors.push(`GitHub variable ${variable.name} cannot specify both value and from.`);
  }
  return errors;
}

/** The rules a JSON schema cannot express: names that refer to each other, and contradictions. */
function semanticErrors(manifest) {
  return [
    ...accountErrors(manifest),
    ...zoneErrors(manifest),
    ...resourceBindingErrors(manifest),
    ...duplicateErrors(manifest),
    ...scopedSecretErrors(manifest.secrets),
    ...githubVariableErrors(manifest),
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
export function readWranglerConfig(file, { environment } = {}) {
  const production = parseJsonc(readFileSync(file, 'utf8'));
  const config = environment ? production.env?.[environment] : production;
  if (!config) throw new Error(`No ${environment} environment in ${file}.`);
  return {
    name: config.name,
    ...wranglerWorkerBindings(config),
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

function configMode(mode) {
  return { mode, isPreview: mode !== undefined && mode !== 'production' };
}

/** Read a cf project's canonical config, including its typed binding builders. */
export async function readCloudflareConfig(file, { mode } = {}) {
  const module = await import(pathToFileURL(file).href);
  const project =
    typeof module.default === 'function' ? await module.default(configMode(mode)) : module.default;
  const worker =
    typeof project?.worker === 'function'
      ? await project.worker(configMode(mode))
      : project?.worker;
  if (!worker?.name || !worker.env)
    throw new Error(`${file} must declare a Worker with a name and env bindings.`);
  const vars = {};
  const d1 = [];
  const r2 = [];
  for (const [binding, entry] of Object.entries(worker.env)) {
    if (entry.type === 'text' || entry.type === 'json') vars[binding] = entry.value;
    if (entry.type === 'd1')
      d1.push({ binding, name: entry.name, id: entry.id, migrationsTable: 'd1_migrations' });
    if (entry.type === 'r2') r2.push({ binding, name: entry.name });
  }
  return { name: worker.name, vars, d1, r2, ...cloudflareWorkerBindings(worker.env) };
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
