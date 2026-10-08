import { parseArgs } from 'node:util';
import { z } from 'zod';
import { accessCredentials, accessHeaders, type AccessCredentials } from './access-auth.js';
import { waitForReleaseIdentity, type ReleaseIdentity } from './release-identity.js';
import type { ReleaseConfiguration } from './release-config.js';
export const workerSmokeSchema = z.strictObject({
  path: z.string().regex(/^\/(?!\/)/),
  status: z.number().int().min(100).max(599),
  body: z.string().optional(),
});
export type WorkerSmoke = z.infer<typeof workerSmokeSchema>;
type Request = (
  url: string,
  options: { headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
) => Promise<Response>;
interface SmokeInput {
  origin: string;
  identity: ReleaseIdentity;
  smoke: WorkerSmoke;
  publicPath?: string | undefined;
  protected?: boolean;
  credentials?: AccessCredentials | undefined;
  request?: Request;
  timeoutMs?: number;
}

export async function verifyWorkerReleaseSmoke(
  input: SmokeInput,
): Promise<{ origin: string; path: string; identity: ReleaseIdentity }> {
  const origin = new URL(input.origin);
  if (origin.protocol !== 'https:' || origin.origin !== input.origin)
    throw new Error('API smoke requires an HTTPS origin without a path.');
  const smoke = workerSmokeSchema.parse(input.smoke);
  const url = new URL(smoke.path, origin).href;
  if (new URL(url).origin !== input.origin)
    throw new Error('API smoke path must stay inside the configured origin.');
  const request = input.request ?? fetch;
  if (input.protected) {
    if (!input.credentials)
      throw new Error('Protected staging verification requires Access credentials.');
    const anonymous = await request(url, {
      headers: {},
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (![302, 401, 403].includes(anonymous.status))
      throw new Error('Anonymous request reached staging.');
    await anonymous.arrayBuffer();
  }
  const identity = await waitForReleaseIdentity(input.origin, input.identity, {
    ...(input.credentials ? { credentials: input.credentials } : {}),
    request,
    publicPath: input.publicPath,
    timeoutMs: input.timeoutMs ?? 0,
  });
  const response = await request(url, {
    headers: accessHeaders(url, input.origin, input.credentials),
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== smoke.status)
    throw new Error(
      `API smoke ${smoke.path} returned ${response.status}; expected ${smoke.status}.`,
    );
  const body = await response.text();
  if (smoke.body !== undefined && body !== smoke.body)
    throw new Error(`API smoke ${smoke.path} response body differs from the declared behavior.`);
  return { origin: input.origin, path: smoke.path, identity };
}
function customOrigin(url: URL, value: string): boolean {
  return (
    url.hostname !== 'workers.dev' &&
    !url.hostname.endsWith('.workers.dev') &&
    url.origin === value &&
    url.protocol === 'https:'
  );
}
function validWorkerLabel(input: {
  workerLabel: string;
  prefix: string;
  worker: string;
  configured: boolean;
}): boolean {
  return (
    (input.configured && input.workerLabel === input.worker) ||
    (/^[a-f0-9]{8}$/.test(input.prefix) && input.workerLabel === `${input.prefix}-${input.worker}`)
  );
}
export function validateWorkerSmokeOrigin(
  value: string,
  config: Pick<
    ReleaseConfiguration,
    'previewUrl' | 'previewWorker' | 'productionUrl' | 'productionWorker' | 'workersDevSubdomain'
  >,
  protectedPreview: boolean,
): void {
  const configuredOrigin = protectedPreview ? config.previewUrl : config.productionUrl;
  const worker = protectedPreview ? config.previewWorker : config.productionWorker;
  const url = new URL(value);
  const configured = value === configuredOrigin;
  if (configured && customOrigin(url, value)) return;
  const labels = url.hostname.split('.');
  const workerLabel = labels[0] ?? '';
  const prefix = workerLabel.slice(0, 8);
  if (
    url.protocol !== 'https:' ||
    Boolean(url.port) ||
    url.origin !== value ||
    labels.length !== 4 ||
    labels[1] !== config.workersDevSubdomain ||
    labels[2] !== 'workers' ||
    labels[3] !== 'dev' ||
    !validWorkerLabel({ workerLabel, prefix, worker, configured })
  )
    throw new Error(
      `Checks require the configured ${protectedPreview ? 'preview' : 'production'} Worker origin.`,
    );
}

export async function runWorkerReleaseSmoke(
  config: ReleaseConfiguration,
  args: string[] = process.argv.slice(2),
): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      url: { type: 'string' },
      commit: { type: 'string' },
      'release-id': { type: 'string' },
      protected: { type: 'boolean', default: false },
      public: { type: 'boolean', default: false },
      'wait-for-propagation': { type: 'boolean', default: false },
    },
  });
  if (!config.smoke)
    throw new Error('Declare the Worker smoke path, expected status, and optional body.');
  if (!values.url || !values.commit || !values['release-id'])
    throw new Error('Pass --url, --commit, and --release-id for API verification.');
  if (values.public === values.protected)
    throw new Error('Select exactly one of --public and --protected.');
  validateWorkerSmokeOrigin(values.url, config, values.protected);
  const verified = await verifyWorkerReleaseSmoke({
    origin: values.url,
    identity: {
      commit: values.commit,
      releaseId: values['release-id'],
      ...(config.profile ? { app: config.profile } : {}),
    },
    publicPath: values.url === config.productionUrl ? config.publicPath : '/',
    smoke: {
      ...config.smoke,
      path:
        values.url === config.productionUrl
          ? `${config.publicPath ?? '/'}${config.smoke.path.slice(1)}`
          : config.smoke.path,
    },
    protected: values.protected,
    credentials: values.protected ? accessCredentials(process.env) : undefined,
    timeoutMs: values['wait-for-propagation'] ? 180_000 : 0,
  });
  process.stdout.write(
    `PASS: verified API ${verified.origin}${verified.path}, release ${verified.identity.releaseId}\n`,
  );
}
