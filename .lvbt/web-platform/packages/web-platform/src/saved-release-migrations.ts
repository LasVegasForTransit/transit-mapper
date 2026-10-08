import { verifyExpectedProductionVersion } from './expected-production-version.js';
import { execFile } from 'node:child_process';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { parse, type ParseError } from 'jsonc-parser';
import { z } from 'zod';
import type { ReleaseConfiguration } from './release-config.js';
import { verifyReleaseAttestation } from './release-attestation.js';
import { verifyCandidateReceipt } from './release-candidate.js';
import { verifyNamedPreview, assertNamedPreviewProtection } from './named-worker-release.js';
import { verifyRelease } from './saved-release-artifact.js';
import { verifyWorkerReleaseConfiguration } from './worker-release-configuration.js';

const execute = promisify(execFile);
const subtree = '.wrangler/worker/migrations';
const manifestFile = `${subtree}/manifest.json`;
const bindingName = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const sqlName = z
  .string()
  .regex(/^[^/\\]+\.sql$/)
  .refine((name) => !name.startsWith('.'));
const manifestSchema = z.strictObject({
  version: z.literal(1),
  bindings: z
    .array(z.strictObject({ binding: bindingName, files: z.array(sqlName).min(1) }))
    .min(1),
});
const databaseSchema = z
  .object({
    binding: z.string(),
    database_id: z.string().min(1),
    migrations_dir: z.string().optional(),
    migrations_pattern: z.string().optional(),
  })
  .loose();
const savedConfigurationSchema = z
  .object({
    d1_databases: z.array(databaseSchema),
    env: z.object({ preview: z.object({ d1_databases: z.array(databaseSchema) }).loose() }).loose(),
  })
  .loose();
async function readConfiguration(directory: string) {
  const errors: ParseError[] = [];
  const value: unknown = parse(
    await readFile(path.join(directory, 'wrangler.jsonc'), 'utf8'),
    errors,
    { allowTrailingComma: true },
  );
  if (errors.length) throw new Error('Invalid reviewed Wrangler configuration.');
  return savedConfigurationSchema.parse(value);
}
function unique(names: string[], description: string): void {
  if (new Set(names).size !== names.length) throw new Error(`Duplicate ${description}.`);
}
async function reviewedDirectory(source: string, directory: string, appDirectory: string) {
  if (path.isAbsolute(directory) || path.win32.isAbsolute(directory) || directory.includes('\\'))
    throw new Error(
      'Migration directories must be relative to the app inside the reviewed repository.',
    );
  const app = await realpath(source);
  const root = await realpath(
    path.resolve(
      app,
      ...appDirectory
        .split('/')
        .filter((part) => part !== '.')
        .map(() => '..'),
    ),
  );
  const target = path.resolve(app, directory);
  const relative = path.relative(root, target);
  if (
    relative === '' ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  )
    throw new Error('Migration directories must stay inside the reviewed repository.');
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    const entry = await lstat(current);
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error('Migration directories cannot contain symlinks or non-directories.');
  }
  return target;
}
function selectedDatabase(databases: z.infer<typeof databaseSchema>[], binding: string) {
  const matching = databases.filter((database) => database.binding === binding);
  if (matching.length !== 1 || !matching[0])
    throw new Error(
      `Saved configuration must contain exactly one ${binding} D1 binding per target.`,
    );
  return matching[0];
}

async function migrationFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const name of (await readdir(directory)).sort()) {
    const entry = await lstat(path.join(directory, name));
    if (entry.isSymbolicLink() || !entry.isFile())
      throw new Error(
        'Use regular SQL files in a flat migration directory; symlinks and nested directories are unsupported.',
      );
    if (name.endsWith('.sql')) files.push(sqlName.parse(name));
  }
  if (!files.length) throw new Error('No SQL migrations found in the declared directory.');
  return files;
}
function retainDatabasePaths(
  saved: z.infer<typeof savedConfigurationSchema>,
  binding: string,
): void {
  for (const databases of [saved.d1_databases, saved.env.preview.d1_databases]) {
    const database = selectedDatabase(databases, binding);
    if (
      database.migrations_pattern &&
      database.migrations_pattern !== `${database.migrations_dir ?? 'migrations'}/*.sql`
    )
      throw new Error('Saved release migrations require a flat SQL migrations_pattern.');
    database.migrations_dir = `${subtree}/${binding}`;
    if (database.migrations_pattern)
      database.migrations_pattern = `${database.migrations_dir}/*.sql`;
  }
}

/** Freeze declared SQL before the existing release inventory is sealed. */
export async function retainReleaseMigrations(
  source: string,
  destination: string,
  config: ReleaseConfiguration,
): Promise<void> {
  if (!config.migrations?.length) return;
  unique(
    config.migrations.map((migration) => bindingName.parse(migration.binding)),
    'migration bindings',
  );
  await verifyWorkerReleaseConfiguration(destination, config);
  const saved = await readConfiguration(destination);
  const retained = [];
  // Validate all declarations before modifying the packaging directory.
  for (const migration of config.migrations) {
    const directory = await reviewedDirectory(source, migration.directory, config.appDirectory);
    const files = await migrationFiles(directory);
    retainDatabasePaths(saved, migration.binding);
    retained.push({ binding: migration.binding, directory, files });
  }
  for (const migration of retained) {
    const target = path.join(destination, subtree, migration.binding);
    await mkdir(target, { recursive: true });
    for (const file of migration.files)
      await cp(path.join(migration.directory, file), path.join(target, file));
  }
  await writeFile(
    path.join(destination, manifestFile),
    `${JSON.stringify({ version: 1, bindings: retained.map(({ binding, files }) => ({ binding, files })) }, null, 2)}\n`,
  );
  await writeFile(path.join(destination, 'wrangler.jsonc'), `${JSON.stringify(saved, null, 2)}\n`);
}

async function verifiedManifest(
  directory: string,
  release: Awaited<ReturnType<typeof verifyRelease>>,
) {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(path.join(directory, manifestFile), 'utf8')),
  );
  unique(
    manifest.bindings.map(({ binding }) => binding),
    'saved migration bindings',
  );
  const saved = await readConfiguration(directory);
  for (const migration of manifest.bindings) {
    unique(migration.files, 'saved migration filenames');
    const relative = `${subtree}/${migration.binding}`;
    for (const databases of [saved.d1_databases, saved.env.preview.d1_databases]) {
      const database = selectedDatabase(databases, migration.binding);
      if (
        database.migrations_dir !== relative ||
        (database.migrations_pattern && database.migrations_pattern !== `${relative}/*.sql`)
      )
        throw new Error('Saved migration directories must match the sealed SQL inventory.');
    }
    const actual = release.files
      .filter(([file]) => file.startsWith(`${relative}/`))
      .map(([file]) => file.slice(relative.length + 1))
      .sort();
    if (JSON.stringify(actual) !== JSON.stringify([...migration.files].sort()))
      throw new Error('Saved migration SQL does not match the sealed declaration.');
  }
  return manifest;
}
async function applyMigrations(
  directory: string,
  manifest: z.infer<typeof manifestSchema>,
  target: string,
  artifactHash: string,
): Promise<void> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lvbt-release-migrate-'));
  try {
    const copy = path.join(temporary, 'release');
    await cp(directory, copy, { recursive: true });
    // Reverify the working copy before invoking Wrangler, which may write cache files.
    if ((await verifyRelease(copy)).artifactHash !== artifactHash)
      throw new Error('Saved release changed while preparing migrations.');
    for (const { binding } of manifest.bindings) {
      try {
        const { stdout } = await execute(
          'pnpm',
          [
            'exec',
            'wrangler',
            'd1',
            'migrations',
            'apply',
            binding,
            '--remote',
            '--config',
            path.join(copy, 'wrangler.jsonc'),
            '--env',
            target === 'preview' ? 'preview' : '',
          ],
          {
            env: { ...process.env, CI: 'true', WRANGLER_LOG_SANITIZE: 'true' },
            maxBuffer: 16 * 1024 * 1024,
          },
        );
        process.stdout.write(stdout);
      } catch (cause) {
        throw new Error(
          `Migration apply failed for ${binding}; reconcile the selected database's applied migrations before retrying or promoting. Earlier migrations may already have succeeded.`,
          { cause },
        );
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function verifyMigrationAuthority(
  config: ReleaseConfiguration,
  input: {
    directory: string;
    target: string;
    attestation?: string | undefined;
    candidate?: string | undefined;
  },
  release: Awaited<ReturnType<typeof verifyRelease>>,
): Promise<void> {
  await verifyReleaseAttestation(config, input.directory, input.attestation);
  await verifyWorkerReleaseConfiguration(input.directory, config);
  if (input.target === 'production' && config.previewOnly)
    throw new Error('Preview-only apps cannot migrate production.');
  if (config.publicationMode !== 'named-staging') return;
  if (input.target === 'preview') await assertNamedPreviewProtection(config);
  else if (input.candidate) await verifyCandidateReceipt(config, release, input.candidate);
  else await verifyNamedPreview(config, release);
}
/** Apply only SQL and database identities contained in a verified saved release. */
export async function runReleaseMigrations(
  config: ReleaseConfiguration,
  args: string[],
): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      directory: { type: 'string' },
      target: { type: 'string' },
      commit: { type: 'string' },
      'release-id': { type: 'string' },
      'attestation-directory': { type: 'string' },
      'candidate-directory': { type: 'string' },
      'expected-version': { type: 'string' },
    },
  });
  if (!values.directory) throw new Error('Pass --directory with the saved release.');
  if (values.target !== 'preview' && values.target !== 'production')
    throw new Error('Pass --target preview or production.');
  const directory = path.resolve(values.directory);
  const release = await verifyRelease(directory);
  if (release.app !== config.profile) throw new Error('Saved release belongs to another app.');
  if (values.commit && release.commit !== values.commit)
    throw new Error('Release commit does not match the selected Actions run.');
  if (values['release-id'] && release.releaseId !== values['release-id'])
    throw new Error('Release ID does not match the selected Actions run.');
  await verifyMigrationAuthority(
    config,
    {
      directory,
      target: values.target,
      attestation: values['attestation-directory'],
      candidate: values['candidate-directory'],
    },
    release,
  );
  if (values.target === 'production')
    await verifyExpectedProductionVersion(config, values['expected-version'], directory);
  if (!release.files.some(([file]) => file === manifestFile)) {
    // Original retained releases did not carry SQL. Preserve their reviewed no-migration behavior.
    if (release.formatVersion === 1) return;
    if (config.migrations?.length)
      throw new Error(
        'This release has no saved migrations; package a new reviewed release with release.migrations.',
      );
    return;
  }
  await applyMigrations(
    directory,
    await verifiedManifest(directory, release),
    values.target,
    release.artifactHash,
  );
}
