import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface WebPreset {
  formatVersion: number;
  preset: string;
  release: string;
  commit: string;
  files: Record<string, string>;
  executables?: string[];
}

export interface PresetMetadata {
  formatVersion: number;
  preset: string;
  release: string;
  commit: string;
  contentHash: string;
  executables: string[];
}

export function fingerprint(files: Record<string, string>): string {
  const entries = Object.keys(files)
    .sort()
    .map((name) => [name, files[name]]);
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

async function readTree(directory: string, prefix = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await readTree(location, `${name}/`));
    else if (entry.isFile()) files[name] = await readFile(location, 'utf8');
    else throw new Error(`Preset integrity failure: unsupported entry ${name}`);
  }
  return files;
}

export async function verifyPreset(root: string): Promise<PresetMetadata> {
  const metadata = JSON.parse(
    await readFile(path.join(root, '.lvbt/web-platform.json'), 'utf8'),
  ) as PresetMetadata;
  const files = await readTree(path.join(root, '.lvbt/web-platform'));
  const executables: string[] = [];
  for (const name of Object.keys(files).sort()) {
    if ((await stat(path.join(root, '.lvbt/web-platform', name))).mode & 0o111)
      executables.push(name);
  }
  if (
    metadata.formatVersion !== 1 ||
    metadata.preset !== 'lvbt-web' ||
    !/^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(metadata.release) ||
    !/^[a-f0-9]{40}$/.test(metadata.commit) ||
    metadata.contentHash !== fingerprint(files) ||
    JSON.stringify(metadata.executables) !== JSON.stringify(executables)
  ) {
    throw new Error('Preset integrity failure. Restore the recorded vendor files before updating.');
  }
  return metadata;
}

function validateBundle(bundle: WebPreset): void {
  if (bundle.executables?.some((name) => !Object.hasOwn(bundle.files, name))) {
    throw new Error('Executable path is absent from the preset.');
  }
  if (
    bundle.formatVersion !== 1 ||
    bundle.preset !== 'lvbt-web' ||
    !/^v\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(bundle.release) ||
    !/^[a-f0-9]{40}$/.test(bundle.commit)
  )
    throw new Error('Invalid web preset provenance.');
  for (const [name, content] of Object.entries(bundle.files)) {
    if (
      typeof content !== 'string' ||
      !name ||
      name.includes('\\') ||
      name.includes('\0') ||
      path.posix.isAbsolute(name) ||
      name.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new Error(`Invalid preset file path: ${name}`);
    }
  }
}

async function install(root: string, bundle: WebPreset): Promise<void> {
  const base = path.join(root, '.lvbt');
  const target = path.join(base, 'web-platform');
  const staging = path.join(base, `web-platform-${randomUUID()}`);
  const backup = `${staging}-backup`;
  const metadataPath = path.join(base, 'web-platform.json');
  const metadata: PresetMetadata = {
    formatVersion: 1,
    preset: 'lvbt-web',
    release: bundle.release,
    commit: bundle.commit,
    contentHash: fingerprint(bundle.files),
    executables: [...(bundle.executables ?? [])].sort(),
  };
  await mkdir(staging, { recursive: true });
  try {
    for (const [name, content] of Object.entries(bundle.files)) {
      await mkdir(path.dirname(path.join(staging, name)), { recursive: true });
      await writeFile(path.join(staging, name), content, {
        flag: 'wx',
        mode: metadata.executables.includes(name) ? 0o755 : 0o644,
      });
    }
    await writeFile(`${staging}.json`, `${JSON.stringify(metadata, null, 2)}\n`);
    if (existsSync(target)) await rename(target, backup);
    try {
      await rename(staging, target);
      await rename(`${staging}.json`, metadataPath);
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      if (existsSync(backup)) await rename(backup, target);
      throw error;
    }
    await rm(backup, { recursive: true, force: true });
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(`${staging}.json`, { force: true });
  }
}

export async function applyPreset(root: string, bundle: WebPreset, dryRun = false) {
  validateBundle(bundle);
  let previous: Record<string, string> = {};
  if (existsSync(path.join(root, '.lvbt/web-platform.json'))) {
    await verifyPreset(root);
    previous = await readTree(path.join(root, '.lvbt/web-platform'));
  } else if (existsSync(path.join(root, '.lvbt/web-platform'))) {
    throw new Error('Untracked preset directory exists; refusing to replace it.');
  }
  const names = Object.keys(bundle.files).sort();
  const plan = {
    added: names.filter((name) => !(name in previous)),
    changed: names.filter((name) => name in previous && bundle.files[name] !== previous[name]),
    removed: Object.keys(previous)
      .sort()
      .filter((name) => !(name in bundle.files)),
  };
  if (!dryRun) await install(root, bundle);
  return plan;
}
