import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WebPreset } from './web-platform.ts';
import { readOptional as optional, rejectSymlinkDestination as rejectSymlinks } from './paths.ts';

const FILES = [
  'CONTRIBUTING.md',
  'pull_request_template.md',
  'ISSUE_TEMPLATE/bug.yml',
  'ISSUE_TEMPLATE/feature.yml',
  'ISSUE_TEMPLATE/config.yml',
];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
async function verifiedOwnership(root: string): Promise<Record<string, string>> {
  await rejectSymlinks(root, 'SOURCE.json');
  const prior = await optional(path.join(root, 'SOURCE.json'));
  if (!prior) return {};
  const source = JSON.parse(prior) as { repository: string; files: Record<string, string> };
  if (source.repository !== 'LasVegasForTransit/repository-tooling')
    throw new Error('SOURCE.json must identify repository-tooling.');
  for (const file of FILES) {
    const destination = file === 'CONTRIBUTING.md' ? file : `.github/${file}`;
    await rejectSymlinks(root, destination);
    const expected = source.files[destination];
    const current = await optional(path.join(root, destination));
    if (expected && (current === null || digest(current) !== expected))
      throw new Error(
        `${destination} is locally changed; preserve or restore it before updating shared community files.`,
      );
  }
  return source.files;
}

async function publicationContents(
  root: string,
  bundle: WebPreset,
): Promise<Record<string, string>> {
  const owned = await verifiedOwnership(root);
  const contents: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  for (const file of FILES) {
    const content =
      bundle.files[`standards/community-health/${file}`] ??
      bundle.files[`community-health/${file}`];
    if (content === undefined) continue;
    const destination = file === 'CONTRIBUTING.md' ? file : `.github/${file}`;
    await rejectSymlinks(root, destination);
    const current = await optional(path.join(root, destination));
    if (!owned[destination] && current !== null && current !== content)
      throw new Error(
        `${destination} is locally changed; review it before adopting shared community files.`,
      );
    contents[destination] = content;
    hashes[destination] = digest(content);
  }
  if (!Object.keys(contents).length) return {};
  contents['SOURCE.json'] =
    `${JSON.stringify({ repository: 'LasVegasForTransit/repository-tooling', ref: bundle.release, commit: bundle.commit, files: hashes }, null, 2)}\n`;
  return contents;
}

/** The registered community-health repository publishes generated shared guidance and templates. */
export async function syncCommunityPublication(
  root: string,
  bundle: WebPreset,
  dryRun: boolean,
): Promise<string[]> {
  const pkg = await optional(path.join(root, 'package.json'));
  if (!pkg || (JSON.parse(pkg) as { name?: string }).name !== 'lvbt-community-health') return [];
  const contents = await publicationContents(root, bundle);
  const changed: string[] = [];
  for (const [file, content] of Object.entries(contents)) {
    if ((await optional(path.join(root, file))) === content) continue;
    changed.push(file);
    if (!dryRun) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), content);
    }
  }
  return changed;
}
