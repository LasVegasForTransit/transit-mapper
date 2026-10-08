import { z } from 'zod';
import { releaseMarkerPath } from './release-path.js';
import { accessHeaders, type AccessCredentials } from './access-auth.js';

export const releaseIdentitySchema = z
  .object({
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    app: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/)
      .optional(),
    releaseId: z.string().regex(/^[1-9][0-9]*$/),
  })
  .strict();
export type ReleaseIdentity = z.infer<typeof releaseIdentitySchema>;
interface ReadOptions {
  publicPath?: string | undefined;
  app?: string | undefined;
  credentials?: AccessCredentials;
  request?: (
    url: string,
    options: { headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
  ) => Promise<Response>;
  requestTimeoutMs?: number;
}
class TransientMarkerError extends Error {}

export async function readReleaseIdentity(
  origin: string,
  options: ReadOptions = {},
): Promise<ReleaseIdentity> {
  const url = `${new URL(origin).origin}${releaseMarkerPath(options.publicPath)}`;
  let response: Response;
  try {
    response = await (options.request ?? fetch)(url, {
      headers: accessHeaders(url, origin, options.credentials),
      redirect: 'manual',
      signal: AbortSignal.timeout(options.requestTimeoutMs ?? 10_000),
    });
  } catch {
    throw new TransientMarkerError('Release marker request failed or timed out.');
  }
  if ([301, 302, 303, 307, 308, 401, 403].includes(response.status))
    throw new Error(`Release marker authentication failed (${response.status}).`);
  if (response.status === 404 || response.status === 429 || response.status >= 500)
    throw new TransientMarkerError(`Release marker unavailable (${response.status}).`);
  if (response.status !== 200) throw new Error(`Release marker unavailable (${response.status}).`);
  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error('Release marker has an invalid identity.', { cause: error });
    throw new TransientMarkerError('Release marker body request failed or timed out.', {
      cause: error,
    });
  }
  const identity = releaseIdentitySchema.safeParse(value);
  if (!identity.success) throw new Error('Release marker has an invalid identity.');
  if (options.app && identity.data.app !== options.app)
    throw new Error('Release marker belongs to another app.');
  return identity.data;
}

function sameIdentity(actual: ReleaseIdentity, expected: ReleaseIdentity): boolean {
  return (
    actual.commit === expected.commit &&
    actual.releaseId === expected.releaseId &&
    actual.app === expected.app
  );
}
export async function waitForReleaseIdentity(
  origin: string,
  expected: ReleaseIdentity,
  options: ReadOptions & {
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<ReleaseIdentity> {
  releaseIdentitySchema.parse(expected);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + (options.timeoutMs ?? 0);
  let last: string;
  for (;;) {
    try {
      const actual = await readReleaseIdentity(origin, {
        ...options,
        ...(expected.app ? { app: expected.app } : {}),
        requestTimeoutMs: Math.max(
          1,
          Math.min(
            options.requestTimeoutMs ?? 10_000,
            options.timeoutMs ? deadline - now() : 10_000,
          ),
        ),
      });
      if (sameIdentity(actual, expected)) return actual;
      last = `observed release ${actual.releaseId} at ${actual.commit}`;
    } catch (error) {
      if (!(error instanceof TransientMarkerError)) throw error;
      last = error.message;
    }
    if (now() >= deadline)
      throw new Error(`Expected release ${expected.releaseId} at ${expected.commit}; ${last}.`);
    await sleep(Math.min(options.intervalMs ?? 5_000, deadline - now()));
  }
}
