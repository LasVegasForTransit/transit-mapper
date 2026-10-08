import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema = z
  .object({
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    app: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .optional(),
    releaseId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  })
  .strict();
const releaseSchema = identitySchema
  .extend({
    formatVersion: z.union([z.literal(1), z.literal(2)]),
    artifactHash: digest,
    artifactKind: z.literal('worker').optional(),
    files: z.array(z.tuple([z.string().min(1), digest])),
  })
  .strict();
export type WebsiteRelease = z.infer<typeof releaseSchema>;
export type SavedReleaseIdentity = z.infer<typeof identitySchema>;

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function inventory(directory: string, relative = ''): Promise<[string, string][]> {
  const stat = await lstat(path.join(directory, relative));
  if (stat.isSymbolicLink()) throw new Error('Release content contains a symbolic link.');
  if (stat.isFile()) return [[relative, hash(await readFile(path.join(directory, relative)))]];
  if (!stat.isDirectory()) throw new Error('Unsupported release file type.');
  const files: [string, string][] = [];
  for (const entry of await readdir(path.join(directory, relative))) {
    if (relative === '' && entry === 'release.json') continue;
    const child = relative ? `${relative}/${entry}` : entry;
    files.push(...(await inventory(directory, child)));
  }
  return files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function artifactHash(
  identity: SavedReleaseIdentity & { artifactKind?: 'worker' | undefined; formatVersion?: 1 | 2 },
  files: [string, string][],
): string {
  return hash(
    JSON.stringify({
      formatVersion: identity.formatVersion ?? 1,
      commit: identity.commit,
      releaseId: identity.releaseId,
      ...(identity.app ? { app: identity.app } : {}),
      ...(identity.artifactKind ? { artifactKind: identity.artifactKind } : {}),
      files,
    }),
  );
}

export interface ArtifactAcceptance {
  forbiddenPaths?: string[] | undefined;
  forbiddenLanguages?: string[] | undefined;
}

async function acceptAssets(
  source: string,
  assets: [string, string][],
  acceptance: ArtifactAcceptance,
): Promise<void> {
  const roots = await readdir(path.join(source, 'dist'));
  for (const forbidden of acceptance.forbiddenPaths ?? []) {
    if (
      roots.includes(forbidden) ||
      assets.some(([file]) => file === forbidden || file.startsWith(`${forbidden}/`))
    )
      throw new Error('Release contains preview-only routes.');
  }
  for (const [name] of assets.filter(([file]) => file.endsWith('.html'))) {
    const content = await readFile(path.join(source, 'dist', name), 'utf8');
    if (
      (acceptance.forbiddenLanguages ?? []).some((language) =>
        content.includes(`lang="${language}"`),
      )
    )
      throw new Error('Release contains a preview-only test language.');
  }
}
export interface SavedReleaseOptions extends ArtifactAcceptance {
  artifactKind?: 'worker';
  formatVersion?: 1 | 2;
}
export async function packageRelease(
  source: string,
  destination: string,
  identity: SavedReleaseIdentity,
  acceptance: SavedReleaseOptions = {},
): Promise<WebsiteRelease> {
  identitySchema.parse(identity);
  const assets = await inventory(path.join(source, 'dist'));
  await inventory(path.join(source, '.wrangler/worker'));
  const config = await lstat(path.join(source, 'wrangler.jsonc'));
  if (config.isSymbolicLink() || !config.isFile())
    throw new Error('Invalid release configuration.');
  await acceptAssets(source, assets, acceptance);
  await mkdir(destination, { recursive: false });
  await cp(path.join(source, 'dist'), path.join(destination, 'dist'), { recursive: true });
  await mkdir(path.join(destination, '.wrangler'));
  await cp(path.join(source, '.wrangler/worker'), path.join(destination, '.wrangler/worker'), {
    recursive: true,
  });
  await cp(path.join(source, 'wrangler.jsonc'), path.join(destination, 'wrangler.jsonc'));
  await writeFile(
    path.join(destination, 'dist/lvbt-release.json'),
    `${JSON.stringify(identity)}\n`,
  );
  return await sealSavedRelease(
    destination,
    identity,
    acceptance.artifactKind,
    acceptance.formatVersion ?? 1,
  );
}

export async function sealSavedRelease(
  directory: string,
  identity: SavedReleaseIdentity,
  artifactKind?: 'worker',
  formatVersion: 1 | 2 = 1,
): Promise<WebsiteRelease> {
  identitySchema.parse(identity);
  const files = await inventory(directory);
  if (
    (!artifactKind && !files.some(([name]) => name === 'dist/index.html')) ||
    !files.some(([name]) => name === '.wrangler/worker/index.js') ||
    !files.some(([name]) => name === 'wrangler.jsonc')
  )
    throw new Error('Release requires its entry point and compiled Worker.');
  const taggedIdentity = { ...identity, formatVersion, ...(artifactKind ? { artifactKind } : {}) };
  const release: WebsiteRelease = {
    ...taggedIdentity,
    files,
    artifactHash: artifactHash(taggedIdentity, files),
  };
  await writeFile(path.join(directory, 'release.json'), `${JSON.stringify(release, null, 2)}\n`, {
    flag: 'wx',
  });
  return release;
}

export async function verifyRelease(directory: string): Promise<WebsiteRelease> {
  const marker = await lstat(path.join(directory, 'release.json'));
  if (marker.isSymbolicLink() || !marker.isFile()) throw new Error('Invalid release manifest.');
  const release = releaseSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'release.json'), 'utf8')),
  );
  const files = await inventory(directory);
  if (
    JSON.stringify(files) !== JSON.stringify(release.files) ||
    artifactHash(release, files) !== release.artifactHash
  )
    throw new Error('Release identity or files do not match the reviewed artifact.');
  if (
    (!release.artifactKind && !files.some(([name]) => name === 'dist/index.html')) ||
    !files.some(([name]) => name === '.wrangler/worker/index.js') ||
    !files.some(([name]) => name === 'wrangler.jsonc')
  )
    throw new Error('Release is incomplete.');
  return release;
}
