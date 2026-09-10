import path from 'node:path';
import { z } from 'zod';

const staticConfig = z.strictObject({
  $schema: z.string().optional(),
  name: z.string().optional(),
  account_id: z.string().optional(),
  compatibility_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  compatibility_flags: z.array(z.string()).optional(),
  assets: z.strictObject({
    directory: z.string(),
    not_found_handling: z.enum(['none', '404-page', 'single-page-application']).optional(),
    html_handling: z
      .enum(['auto-trailing-slash', 'force-trailing-slash', 'drop-trailing-slash', 'none'])
      .optional(),
  }),
  observability: z.unknown().optional(),
  routes: z.unknown().optional(),
  route: z.unknown().optional(),
  workers_dev: z.boolean().optional(),
  preview_urls: z.boolean().optional(),
  vars: z.record(z.string(), z.unknown()).optional(),
});

export function previewConfiguration(
  input: unknown,
  worker: string,
  assets: string,
  mode: 'version' | 'temporary',
) {
  const config = staticConfig.parse(input);
  z.string()
    .regex(/^[a-z0-9-]{1,63}$/)
    .parse(worker);
  if (!path.isAbsolute(assets)) throw new Error('Preview assets require an absolute bundle path.');
  if (Object.keys(config.vars ?? {}).some((key) => key !== 'CLOUDFLARE_WEB_ANALYTICS_TOKEN'))
    throw new Error('Application variables require explicit isolated preview configuration.');
  return {
    name: worker,
    ...(config.account_id ? { account_id: config.account_id } : {}),
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags ?? [],
    assets: { ...config.assets, directory: assets },
    routes: [],
    workers_dev: mode === 'temporary',
    preview_urls: true,
  };
}

export function previewUploadReceipt(output: string, worker: string) {
  const records = output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown);
  const schema = z.object({
    type: z.literal('version-upload'),
    version: z.literal(1),
    worker_name: z.literal(worker),
    version_id: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
    preview_url: z.url(),
  });
  const uploads = records
    .map((record) => schema.safeParse(record))
    .filter((result) => result.success);
  if (uploads.length !== 1 || !uploads[0]?.success)
    throw new Error('Expected one matching Worker version upload receipt.');
  const receipt = uploads[0].data;
  const url = new URL(receipt.preview_url);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.workers.dev') ||
    !url.hostname.startsWith(`${receipt.version_id.slice(0, 8)}-${worker}.`) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Preview URL does not identify the uploaded Worker version.');
  return { version: receipt.version_id, url: receipt.preview_url };
}
