import { execFileSync } from 'node:child_process';
import { z } from 'zod';

const envelope = z.object({
  success: z.literal(true),
  result: z.unknown(),
  result_info: z
    .object({
      page: z.number().int().positive().optional(),
      total_pages: z.number().int().nonnegative().optional(),
      total_count: z.number().int().nonnegative().optional(),
      per_page: z.number().int().positive().optional(),
    })
    .optional(),
});

export function cloudflareReader(
  token: string,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  async function get(endpoint: string) {
    if (!/^(accounts|zones)(\/|\?)/.test(endpoint) || /\.\.|[\\#]/.test(endpoint))
      throw new Error('Cloudflare reads require an account or zone API path.');
    let response: Response;
    try {
      response = await request(`https://api.cloudflare.com/client/v4/${endpoint}`, {
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('Cloudflare request failed or timed out.');
    }
    if (!response.ok)
      throw new Error(`Cloudflare HTTP ${response.status}; check credential permissions.`);
    const parsed = envelope.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success)
      throw new Error('Cloudflare returned an invalid or unsuccessful response.');
    return parsed.data;
  }
  async function list(endpoint: string) {
    const result: unknown[] = [];
    for (let page = 1; page <= 200; page += 1) {
      const separator = endpoint.includes('?') ? '&' : '?';
      const response = await get(`${endpoint}${separator}page=${page}&per_page=50`);
      if (!Array.isArray(response.result))
        throw new Error('Cloudflare list response is not an array.');
      result.push(...z.array(z.unknown()).parse(response.result));
      const info = response.result_info;
      if (info?.page !== undefined && info.page !== page)
        throw new Error('Cloudflare pagination did not advance.');
      const pages =
        info?.total_pages ??
        (info?.total_count !== undefined && info.per_page !== undefined
          ? Math.ceil(info.total_count / info.per_page)
          : 1);
      if (page >= pages) return result;
    }
    throw new Error('Cloudflare pagination exceeded the audit limit.');
  }
  return { get: async (endpoint: string) => (await get(endpoint)).result, list };
}

export function cloudflareCredential(root: string) {
  try {
    const output = execFileSync('pnpm', ['exec', 'wrangler', 'auth', 'token', '--json'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    const credential = z
      .object({ type: z.enum(['oauth', 'api_token']), token: z.string().min(1) })
      .parse(JSON.parse(output));
    return credential.token;
  } catch {
    throw new Error(
      'Cloudflare credentials unavailable. Authenticate Wrangler or provide CLOUDFLARE_API_TOKEN through the environment.',
    );
  }
}

export function authenticatedCloudflareReader(root: string) {
  return cloudflareReader(cloudflareCredential(root));
}
