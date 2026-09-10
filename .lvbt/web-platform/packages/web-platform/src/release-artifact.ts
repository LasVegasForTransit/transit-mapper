import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const releaseSchema = z
  .object({
    formatVersion: z.literal(1),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ReleaseMarker = z.infer<typeof releaseSchema>;

async function inventory(root: string, directory = root): Promise<[string, string][]> {
  const files: [string, string][] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Archive assets contain a symbolic link: ${file}`);
    if (entry.isDirectory()) files.push(...(await inventory(root, file)));
    else if (entry.isFile()) {
      files.push([
        path.relative(root, file).split(path.sep).join('/'),
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      ]);
    } else if (!entry.isFile()) throw new Error(`Unsupported asset type: ${file}`);
  }
  return files.sort(([left], [right]) => left.localeCompare(right));
}

export async function sealArtifact(
  directory: string,
  identity: { slug: string; commit: string },
): Promise<ReleaseMarker> {
  releaseSchema.parse({ ...identity, formatVersion: 1, artifactHash: '0'.repeat(64) });
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error('The asset directory must be a regular directory, not a symbolic link.');
  const files = await inventory(directory);
  const rootIndex = files.some(([name]) => name === 'index.html');
  const prefixedIndex = files.some(([name]) => name === `${identity.slug}/index.html`);
  if (rootIndex === prefixedIndex)
    throw new Error('Expected one unambiguous root or slug-prefixed index.html.');
  const markerPath = `${identity.slug === 'home' ? '' : `${identity.slug}/`}lvbt-release.json`;
  const marker: ReleaseMarker = {
    formatVersion: 1,
    ...identity,
    artifactHash: createHash('sha256')
      .update(JSON.stringify(files.filter(([name]) => name !== markerPath)))
      .digest('hex'),
  };
  const destination = path.join(directory, markerPath);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(marker)}\n`, { flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return marker;
}

export async function verifyReleaseResponse(
  response: Response,
  expected: ReleaseMarker,
): Promise<void> {
  if (response.status !== 200) throw new Error(`Release marker returned HTTP ${response.status}.`);
  const actual = releaseSchema.parse(await response.json());
  if (
    actual.slug !== expected.slug ||
    actual.commit !== expected.commit ||
    actual.artifactHash !== expected.artifactHash
  ) {
    throw new Error('The public release marker does not match the built artifact.');
  }
}
