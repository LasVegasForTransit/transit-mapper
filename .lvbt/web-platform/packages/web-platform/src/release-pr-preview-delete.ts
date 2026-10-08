import { z } from 'zod';
import type { ReleaseConfiguration } from './release-config.js';

/** Delete only a derived PR Worker after checking the authenticated account's public identity. */
export async function deleteNamedPrPreview(config: ReleaseConfiguration): Promise<void> {
  const account = z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .parse(process.env.CLOUDFLARE_ACCOUNT_ID);
  const token = z.string().min(1).parse(process.env.CLOUDFLARE_API_TOKEN);
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers`;
  const options = {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error' as const,
    signal: AbortSignal.timeout(30_000),
  };
  const identity = await fetch(`${base}/subdomain`, options);
  if (!identity.ok) throw new Error('Cannot verify the preview Cloudflare account.');
  const actual = z
    .object({ success: z.literal(true), result: z.object({ subdomain: z.string() }) })
    .parse(await identity.json());
  if (actual.result.subdomain !== config.workersDevSubdomain)
    throw new Error('Refusing deletion outside the reviewed Workers account.');
  const response = await fetch(`${base}/scripts/${config.previewWorker}?force=true`, {
    ...options,
    method: 'DELETE',
  });
  if (response.status === 404) return;
  const result = z
    .object({ success: z.boolean(), errors: z.array(z.object({ code: z.number() })).optional() })
    .parse(await response.json());
  if (response.ok && result.success) return;
  if (result.errors?.some((error) => error.code === 10007)) return;
  throw new Error(
    `PR preview deletion failed (${response.status}); reconcile the selected Worker before retrying.`,
  );
}
