import { publicPathSchema, productionEndpoint } from './release-path.js';
import { workerSmokeSchema } from './worker-release-smoke.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { legacyArtifactsSchema } from './legacy-release-attestation.js';

const origin = z
  .url({ protocol: /^https$/ })
  .refine((value) => new URL(value).origin === value, 'Use an HTTPS origin without a path.');
const worker = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
export const releaseConfigurationSchema = z
  .object({
    repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    appDirectory: z
      .string()
      .min(1)
      .refine(
        (value) => !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..'),
        'Keep the app inside the checked repository.',
      ),
    productionUrl: origin,
    previewUrl: origin,
    productionWorker: worker,
    previewWorker: worker,
    artifactPrefix: worker,
    workersDevSubdomain: z
      .string()
      .max(63)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
      .optional(),
    profile: worker.optional(),
    publicPath: publicPathSchema.optional(),
    attestation: z
      .strictObject({
        signerWorkflow: z.literal(
          'LasVegasForTransit/repository-tooling/.github/workflows/release-attest.yml',
        ),
        signerCommit: z.string().regex(/^[a-f0-9]{40}$/),
        legacyArtifacts: legacyArtifactsSchema.optional(),
      })
      .optional(),
    previewOnly: z.boolean().optional(),
    publicationMode: z.enum(['version', 'named-staging']).optional(),
    previewReadOnlyBindings: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]*$/))
      .refine(
        (names) => new Set(names).size === names.length,
        'Declare unique preview read-only bindings.',
      )
      .optional(),
    smoke: workerSmokeSchema.optional(),
    previewBindings: z.record(z.string(), z.unknown()).optional(),
    artifactSource: z.enum(['legacy-worker', 'cf-output', 'typed-worker']).optional(),
    typedConfig: z.string().min(1).optional(),
    assetsDirectory: z.string().min(1).optional(),
    migrations: z
      .array(
        z.strictObject({
          binding: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
          directory: z.string().min(1),
        }),
      )
      .optional(),
    artifactAcceptance: z
      .object({
        forbiddenPaths: z.array(z.string().min(1)).optional(),
        forbiddenLanguages: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    stagingWorkflow: z.object({
      name: z.string().min(1),
      path: z.string().regex(/^\.github\/workflows\/[a-z0-9-]+\.ya?ml$/),
      branch: z.string().min(1).default('main'),
    }),
    promotionWorkflow: z.object({
      file: z.string().regex(/^[a-z0-9-]+\.ya?ml$/),
      titlePrefix: z.string().min(1),
      branch: z.string().min(1),
    }),
  })
  .strict()
  .refine(
    (config) =>
      config.productionWorker !== config.previewWorker &&
      config.productionUrl !== config.previewUrl,
    'Staging and production require separate Workers and origins.',
  )
  .refine(
    (config) => config.artifactSource !== 'typed-worker' || Boolean(config.typedConfig),
    'Typed Worker releases require the canonical typedConfig.',
  );
export type ReleaseConfiguration = z.infer<typeof releaseConfigurationSchema>;
function configuredUrl(
  value: Record<string, unknown>,
  field: string,
  env: Record<string, string | undefined>,
): unknown {
  const selector = value[`${field}Env`];
  if (selector === undefined) return value[field];
  const name = z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]*$/)
    .parse(selector);
  const result = env[name]?.trim();
  if (!result) throw new Error(`Configure ${name} with the app's HTTPS origin before releasing.`);
  return result;
}
async function repositoryOrigin(
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<string> {
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('git', ['remote', 'get-url', 'origin'], { cwd });
  const remote = stdout.trim();
  const ssh = /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remote);
  if (ssh?.[1]) return ssh[1];
  const url = new URL(remote);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Configure a GitHub origin or an explicit release repository.');
  return url.pathname.slice(1).replace(/\.git$/, '');
}
function configuredWorkersSubdomain(
  value: Record<string, unknown>,
  env: Record<string, string | undefined>,
) {
  if (value.workersDevSubdomainEnv === undefined) return value.workersDevSubdomain;
  if (value.workersDevSubdomain !== undefined)
    throw new Error('Declare workersDevSubdomain or workersDevSubdomainEnv, not both.');
  const name = z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]*$/)
    .parse(value.workersDevSubdomainEnv);
  const label = env[name]?.trim();
  if (!label)
    throw new Error(`Configure ${name} with the reviewed Workers account label before releasing.`);
  return label;
}
async function resolveConfiguration(
  cwd: string,
  value: Record<string, unknown>,
  env: Record<string, string | undefined>,
): Promise<ReleaseConfiguration> {
  const productionUrl = configuredUrl(value, 'productionUrl', env);
  const previewUrl = configuredUrl(value, 'previewUrl', env);
  const workersDevSubdomain = configuredWorkersSubdomain(value, env);
  const repository = value.repository ?? (await repositoryOrigin(cwd, env));
  let previewBindings = value.previewBindings;
  if (value.previewBindingsEnv !== undefined) {
    const name = z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/)
      .parse(value.previewBindingsEnv);
    const input = env[name]?.trim();
    if (!input)
      throw new Error(
        `Configure ${name} with isolated preview binding declarations before releasing.`,
      );
    previewBindings = JSON.parse(input) as unknown;
  }
  const {
    productionUrlEnv: _productionUrlEnv,
    previewUrlEnv: _previewUrlEnv,
    previewBindingsEnv: _previewBindingsEnv,
    workersDevSubdomainEnv: _workersDevSubdomainEnv,
    ...release
  } = value;
  return releaseConfigurationSchema.parse({
    ...release,
    repository,
    productionUrl,
    previewUrl,
    workersDevSubdomain,
    ...(previewBindings ? { previewBindings } : {}),
  });
}

function assertProfiles(configs: ReleaseConfiguration[]): void {
  for (const fields of [
    configs.map((config) => config.artifactPrefix),
    configs.flatMap((config) => [config.productionWorker, config.previewWorker]),
    configs.flatMap((config) => [productionEndpoint(config), config.previewUrl]),
  ])
    if (new Set(fields).size !== fields.length)
      throw new Error('Release apps require distinct artifacts, Worker namespaces, and origins.');
}

export async function readReleaseConfiguration(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
  app: string | undefined = env.LVBT_RELEASE_APP,
): Promise<ReleaseConfiguration> {
  const tooling = z
    .object({ version: z.literal(1), release: z.record(z.string(), z.unknown()) })
    .parse(JSON.parse(await readFile(path.join(cwd, '.lvbt/tooling.json'), 'utf8')));
  const { apps, ...common } = tooling.release;
  if (apps === undefined) {
    if (app) throw new Error(`Unknown release app: ${app}.`);
    return await resolveConfiguration(cwd, common, env);
  }
  const profiles = z.record(worker, z.record(z.string(), z.unknown())).parse(apps);
  const configs = await Promise.all(
    Object.entries(profiles).map(async ([profile, values]) => {
      if (
        ['repository', 'stagingWorkflow', 'promotionWorkflow', 'profile', 'apps'].some(
          (key) => key in values,
        )
      )
        throw new Error('Release apps cannot override the repository or workflow identity.');
      return await resolveConfiguration(cwd, { ...common, ...values, profile }, env);
    }),
  );
  assertProfiles(configs);
  if (!app) throw new Error('Select --app with a named release profile.');
  const selected = configs.find((config) => config.profile === app);
  if (!selected) throw new Error(`Unknown release app: ${app}.`);
  return selected;
}
