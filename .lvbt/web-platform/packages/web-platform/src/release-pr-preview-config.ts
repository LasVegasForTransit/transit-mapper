import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { ReleaseConfiguration } from './release-config.js';

export function prPreviewArguments(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      pr: { type: 'string' },
      commit: { type: 'string' },
      'release-id': { type: 'string' },
      'publication-mode': { type: 'string' },
      protection: { type: 'string' },
      action: { type: 'string', default: 'deploy' },
    },
  });
  return z
    .strictObject({
      number: z.string().regex(/^[1-9][0-9]{0,9}$/),
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      releaseId: z.string().regex(/^[1-9][0-9]*$/),
      publicationMode: z.enum(['version', 'named-staging']),
      protection: z.enum(['public', 'access']),
      action: z.enum(['deploy', 'delete', 'resolve']),
    })
    .parse({
      number: values.pr,
      commit: values.commit,
      releaseId: values['release-id'],
      publicationMode: values['publication-mode'],
      protection: values.protection,
      action: values.action,
    });
}

export function prPreviewConfiguration(
  config: ReleaseConfiguration,
  number: string,
): ReleaseConfiguration {
  if (!/^[1-9][0-9]{0,9}$/.test(number)) throw new Error('Use a positive pull request number.');
  const worker = `${config.productionWorker}-pr-${number}`;
  if (worker.length > 63 || !config.workersDevSubdomain)
    throw new Error('Configure a reviewed Workers account and a bounded PR Worker name.');
  const { attestation: _attestation, ...preview } = config;
  return {
    ...preview,
    previewOnly: true,
    publicationMode: 'version',
    previewWorker: worker,
    previewUrl: `https://${worker}.${config.workersDevSubdomain}.workers.dev`,
  };
}

export async function assertPrPreviewEvent(
  config: ReleaseConfiguration,
  input: { number: string; commit: string; releaseId: string; action: string },
): Promise<void> {
  if (
    process.env.GITHUB_EVENT_NAME !== 'pull_request' ||
    process.env.GITHUB_REPOSITORY !== config.repository ||
    process.env.GITHUB_SHA !== input.commit ||
    process.env.GITHUB_RUN_ID !== input.releaseId ||
    !process.env.GITHUB_EVENT_PATH
  )
    throw new Error('PR previews require the matching GitHub pull_request run and repository.');
  const event = z
    .object({
      action: z.string(),
      number: z.number().int().positive(),
      pull_request: z.object({
        head: z.object({ repo: z.object({ full_name: z.literal(config.repository) }) }),
        base: z.object({
          ref: z.literal(config.stagingWorkflow.branch),
          repo: z.object({ full_name: z.literal(config.repository) }),
        }),
      }),
    })
    .parse(JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')));
  if (String(event.number) !== input.number)
    throw new Error('PR preview number does not match the trusted event.');
  if ((event.action === 'closed') !== (input.action === 'delete'))
    throw new Error('Deletion requires a closed PR; closed PRs cannot deploy previews.');
}

export function namedPrConfiguration(value: unknown, config: ReleaseConfiguration): unknown {
  const saved = z
    .object({ env: z.object({ preview: z.record(z.string(), z.unknown()) }).loose() })
    .loose()
    .parse(value);
  const preview = saved.env.preview;
  const durable =
    preview.durable_objects === undefined
      ? undefined
      : z
          .object({
            bindings: z.array(z.object({ script_name: z.string().optional() }).loose()),
          })
          .loose()
          .parse(preview.durable_objects);
  return {
    ...saved,
    env: {
      preview: {
        ...preview,
        name: config.previewWorker,
        routes: [],
        route: undefined,
        workers_dev: true,
        preview_urls: true,
        triggers: { crons: [] },
        ...(durable
          ? {
              durable_objects: {
                ...durable,
                bindings: durable.bindings.map((binding) => ({
                  ...binding,
                  script_name: config.previewWorker,
                })),
              },
            }
          : {}),
      },
    },
  };
}
