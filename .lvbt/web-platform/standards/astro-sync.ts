import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// An Astro package generates its astro:content and environment types with `astro sync`. On a
// clean checkout, as in CI, type-aware lint rules fail on every module that imports them until it
// has run. Every Astro package gets a `sync` script, and turbo.json runs it before lint and caches
// what it writes. `lvbt check contract` requires the same wiring.
const SYNC_SCRIPT = 'astro sync';
const SYNC_TASK = { outputs: ['.astro/**'] };
const PRINT_WIDTH = 100;

type JsonObject = Record<string, unknown>;
interface Manifest extends JsonObject {
  dependencies?: JsonObject;
  devDependencies?: JsonObject;
  scripts?: JsonObject;
}
interface Turbo extends JsonObject {
  tasks?: JsonObject;
}
interface Placement {
  before?: string;
  after?: string;
}

/** The `packages:` globs in pnpm-workspace.yaml, without a YAML dependency. */
async function workspaceGlobs(root: string): Promise<string[]> {
  const text = await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8').catch(() => '');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^packages:\s*$/.test(line));
  if (start === -1) return [];
  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (/^\s+-\s+/.test(line)) globs.push(line.replace(/^\s+-\s+/, '').replace(/^['"]|['"]$/g, ''));
  }
  return globs;
}

/** The directories one glob names: each child of `parent/*`, or the path itself. */
async function expand(root: string, glob: string): Promise<string[]> {
  if (!glob.endsWith('/*')) return [glob];
  const parent = glob.slice(0, -2);
  const entries = await readdir(path.join(root, parent), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => `${parent}/${entry.name}`);
}

async function workspacePackages(root: string): Promise<string[]> {
  const directories: string[] = [];
  for (const glob of await workspaceGlobs(root)) directories.push(...(await expand(root, glob)));
  return directories.filter((directory) => existsSync(path.join(root, directory, 'package.json')));
}

/** A copy of `object` with `key` placed before or after another key, or last when it is absent. */
function withEntry(object: JsonObject, key: string, value: unknown, at: Placement): JsonObject {
  const entries = Object.entries(object);
  const anchor = entries.findIndex(([name]) => name === (at.before ?? at.after));
  if (anchor === -1) return { ...object, [key]: value };
  entries.splice(at.before ? anchor : anchor + 1, 0, [key, value]);
  return Object.fromEntries(entries);
}

function formatArray(value: unknown[], indent: string, lead: number): string {
  if (value.length === 0) return '[]';
  const plain = value.every((item) => item === null || typeof item !== 'object');
  const inline = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
  if (plain && lead + inline.length + 1 <= PRINT_WIDTH) return inline;
  const inner = `${indent}  `;
  const items = value.map((item) => `${inner}${formatJson(item, inner, inner.length)}`);
  return `[\n${items.join(',\n')}\n${indent}]`;
}

function formatObject(value: JsonObject, indent: string): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  const inner = `${indent}  `;
  const lines = entries.map(([key, item]) => {
    const label = `${JSON.stringify(key)}: `;
    return `${inner}${label}${formatJson(item, inner, inner.length + label.length)}`;
  });
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

/**
 * JSON as Prettier prints a .json file: objects expanded one key per line, and arrays of plain
 * values on one line when the whole line fits the organization's print width.
 */
export function formatJson(value: unknown, indent = '', lead = 0): string {
  if (Array.isArray(value)) return formatArray(value, indent, lead);
  if (value !== null && typeof value === 'object') return formatObject(value as JsonObject, indent);
  return JSON.stringify(value);
}

// Astro loads its configuration from the first of these it finds in the project's root.
const ASTRO_CONFIGS = ['mjs', 'js', 'ts', 'mts', 'cjs', 'cts'].map((ext) => `astro.config.${ext}`);

/**
 * An Astro project depends on astro and has its own configuration. A library that only imports
 * Astro's types, such as an integration or components, has nothing for `astro sync` to generate.
 */
function isAstroProject(root: string, directory: string, manifest: Manifest): boolean {
  if (!manifest.dependencies?.astro && !manifest.devDependencies?.astro) return false;
  return ASTRO_CONFIGS.some((name) => existsSync(path.join(root, directory, name)));
}

/** Gives each Astro package a `sync` script; reports whether any exist and which files change. */
async function addSyncScripts(root: string, dryRun: boolean) {
  const changed: string[] = [];
  let astro = false;
  for (const directory of await workspacePackages(root)) {
    const file = path.join(root, directory, 'package.json');
    const manifest = JSON.parse(await readFile(file, 'utf8')) as Manifest;
    if (!isAstroProject(root, directory, manifest)) continue;
    astro = true;
    if (manifest.scripts?.sync) continue;
    manifest.scripts = withEntry(manifest.scripts ?? {}, 'sync', SYNC_SCRIPT, { after: 'lint' });
    changed.push(`${directory}/package.json`);
    // Prettier prints package.json exactly as JSON.stringify does.
    if (!dryRun) await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { astro, changed };
}

/** The turbo.json tasks with a `sync` task that `lint` depends on. */
function wiredTasks(tasks: JsonObject): JsonObject {
  const withSync = tasks.sync ? tasks : withEntry(tasks, 'sync', SYNC_TASK, { before: 'lint' });
  const lint = (withSync.lint ?? { dependsOn: ['^lint'] }) as { dependsOn?: string[] };
  const dependsOn = lint.dependsOn ?? [];
  if (dependsOn.includes('sync')) return withSync;
  return { ...withSync, lint: { ...lint, dependsOn: [...dependsOn, 'sync'] } };
}

/** Runs `sync` before `lint` in the root turbo.json; returns the file when it changes. */
async function wireTurbo(root: string, dryRun: boolean): Promise<string[]> {
  const file = path.join(root, 'turbo.json');
  let turbo: Turbo;
  try {
    turbo = JSON.parse(await readFile(file, 'utf8')) as Turbo;
  } catch {
    // A missing or commented turbo.json is left alone; `lvbt check contract` names what to add.
    return [];
  }
  if (!turbo.tasks) return [];
  const tasks = wiredTasks(turbo.tasks);
  if (tasks === turbo.tasks) return [];
  if (!dryRun) await writeFile(file, `${formatJson({ ...turbo, tasks })}\n`);
  return ['turbo.json'];
}

/** Adds the `sync` script to each Astro package and runs it before lint in turbo.json. */
export async function syncAstroTypesBeforeLint(root: string, dryRun: boolean): Promise<string[]> {
  const { astro, changed } = await addSyncScripts(root, dryRun);
  if (!astro) return changed;
  return [...changed, ...(await wireTurbo(root, dryRun))];
}
