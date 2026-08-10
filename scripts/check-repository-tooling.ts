#!/usr/bin/env tsx
/**
 * Confirms that this repository consumes one unmodified LVBT contribution
 * plugin release and leaves GitHub's organization templates unshadowed.
 *
 * Agent hooks constrain creation actions before they leave the workstation.
 * This check covers the durable repository artifacts: the pinned plugin,
 * harness wiring, and inheritance boundary.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PLUGIN_ROOT = resolve(ROOT, 'plugins/lvbt-contributions');

interface ToolingLock {
  repository: string;
  ref: string;
  commit: string;
  plugin: string;
  version: string;
  sha256: string;
}

interface PluginManifest {
  name: string;
  version: string;
}

interface Marketplace {
  plugins: Array<{
    name: string;
    source: { source: string; path: string };
  }>;
}

interface ClaudeSettings {
  extraKnownMarketplaces?: Record<
    string,
    { source?: { source?: string; repo?: string; ref?: string } }
  >;
  enabledPlugins?: Record<string, boolean>;
}

async function jsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(ROOT, path), 'utf8')) as T;
}

async function pluginFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? pluginFiles(path) : [path];
    }),
  );
  return nested.flat();
}

async function pluginDigest(): Promise<string> {
  const hash = createHash('sha256');
  const files = (await pluginFiles(PLUGIN_ROOT)).sort();
  for (const file of files) {
    hash.update(relative(PLUGIN_ROOT, file));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function fail(message: string): never {
  throw new Error(`repository tooling: ${message}`);
}

const lock = await jsonFile<ToolingLock>('.lvbt/repository-tooling.json');
if (lock.repository !== 'LasVegasForTransit/repository-tooling') {
  fail('the lock points at a non-organization source');
}
if ((await pluginDigest()) !== lock.sha256) {
  fail('the installed plugin differs from the pinned release');
}

const codex = await jsonFile<PluginManifest>(
  'plugins/lvbt-contributions/.codex-plugin/plugin.json',
);
const claude = await jsonFile<PluginManifest>(
  'plugins/lvbt-contributions/.claude-plugin/plugin.json',
);
if (codex.name !== lock.plugin || claude.name !== lock.plugin) {
  fail('the harness manifests name a different plugin');
}
if (codex.version !== lock.version || claude.version !== lock.version) {
  fail('the harness manifests do not match the pinned version');
}

const marketplace = await jsonFile<Marketplace>('.agents/plugins/marketplace.json');
const listed = marketplace.plugins.find(({ name }) => name === lock.plugin);
if (
  listed?.source.source !== 'local' ||
  listed.source.path !== '../../plugins/lvbt-contributions'
) {
  fail('the Codex marketplace does not load the pinned local plugin');
}

const codexHooks = await readFile(resolve(ROOT, '.codex/hooks.json'), 'utf8');
if (
  !codexHooks.includes('codex-pre-tool-use.mjs') ||
  !codexHooks.includes('"matcher": "Bash|') ||
  codexHooks.includes('$CLAUDE_PLUGIN_ROOT')
) {
  fail('the Codex creation guard is not configured');
}

const claudeSettings = await jsonFile<ClaudeSettings>('.claude/settings.json');
const claudeSource = claudeSettings.extraKnownMarketplaces?.lvbt?.source;
if (
  claudeSource?.source !== 'github' ||
  claudeSource.repo !== lock.repository ||
  claudeSource.ref !== lock.ref ||
  claudeSettings.enabledPlugins?.['lvbt-contributions@lvbt'] !== true
) {
  fail('Claude does not load the pinned organization plugin');
}

const agents = await readFile(resolve(ROOT, 'AGENTS.md'), 'utf8');
if (!agents.includes('github-contribution') || !agents.includes('github-create.mjs')) {
  fail('AGENTS.md does not require the shared creation workflow');
}

const issueTemplates = await readdir(resolve(ROOT, '.github/ISSUE_TEMPLATE')).catch(
  (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  },
);
const localPullRequestTemplate = await readFile(
  resolve(ROOT, '.github/pull_request_template.md'),
).catch((error: unknown) => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
  throw error;
});
if (issueTemplates.length > 0 || localPullRequestTemplate) {
  fail('local GitHub templates shadow the organization defaults');
}

console.log(
  `repository tooling: ${lock.plugin} ${lock.version} matches ${lock.ref}; organization templates are inherited.`,
);
