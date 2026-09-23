import { execFileSync } from 'node:child_process';
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { applyPreset } from './web-platform.ts';
import { readRelease } from './web-platform-source.ts';

const examples = new Set(['basic', 'with-astro', 'with-vite-react']);
const dependencyFields = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

interface Manifest {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

async function manifestPaths(root: string): Promise<string[]> {
  const manifests = [path.join(root, 'package.json')];
  for (const parent of ['apps', 'packages']) {
    const directory = path.join(root, parent);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) manifests.push(path.join(directory, entry.name, 'package.json'));
    }
  }
  return manifests;
}

async function rewriteManifest(root: string, file: string): Promise<void> {
  const manifest = JSON.parse(await readFile(file, 'utf8')) as Manifest;
  for (const field of dependencyFields) {
    const dependencies = manifest[field];
    if (!dependencies) continue;
    for (const name of Object.keys(dependencies)) {
      if (!name.startsWith('@lasvegasfortransit/')) continue;
      const packageName = name.slice('@lasvegasfortransit/'.length);
      const target = path.join(root, '.lvbt/web-platform/packages', packageName);
      const relative = path.relative(path.dirname(file), target).split(path.sep).join('/');
      dependencies[name] = `file:${relative}`;
    }
  }
  if (file === path.join(root, 'package.json')) {
    manifest.scripts ??= {};
    manifest.scripts['standards:update'] =
      'node .lvbt/web-platform/standards/web-platform-cli.ts update';
    manifest.scripts['standards:check'] =
      'node .lvbt/web-platform/standards/web-platform-cli.ts check';
    const check = manifest.scripts.check;
    if (!check) throw new Error('The template root must define a check script.');
    if (!check.startsWith('pnpm standards:check && ')) {
      manifest.scripts.check = `pnpm standards:check && ${check}`;
    }
  }
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function materializeTemplate(options: {
  source: string;
  target: string;
  example: string;
  release: string;
}): Promise<void> {
  const source = path.resolve(options.source);
  const target = path.resolve(options.target);
  if (!examples.has(options.example))
    throw new Error(`Unknown template example: ${options.example}`);
  if (source === target) throw new Error('Source and target directories must differ.');

  const bundle = readRelease(source, options.release);
  const git = (args: string[]) =>
    execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  if (git(['rev-parse', 'HEAD']) !== bundle.commit || git(['status', '--porcelain'])) {
    throw new Error('Template publication requires a clean checkout of the requested release.');
  }

  const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.name !== '.git')
      .map((entry) => rm(path.join(target, entry.name), { recursive: true, force: true })),
  );
  await cp(path.join(source, 'examples', options.example), target, { recursive: true });
  await applyPreset(target, bundle);
  for (const file of await manifestPaths(target)) await rewriteManifest(target, file);
}

export async function main(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      source: { type: 'string' },
      target: { type: 'string' },
      example: { type: 'string' },
      release: { type: 'string' },
    },
  });
  if (!values.source || !values.target || !values.example || !values.release) {
    throw new Error(
      'Usage: --source <repository> --target <directory> --example <name> --release <tag>',
    );
  }
  await materializeTemplate({
    source: values.source,
    target: values.target,
    example: values.example,
    release: values.release,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
