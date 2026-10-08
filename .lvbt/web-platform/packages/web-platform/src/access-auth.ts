export interface AccessCredentials {
  clientId: string;
  clientSecret: string;
}

export function accessCredentials(
  env: Record<string, string | undefined>,
): AccessCredentials | undefined {
  const clientId = env.CF_ACCESS_CLIENT_ID?.trim();
  const clientSecret = env.CF_ACCESS_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret))
    throw new Error('Set both Cloudflare Access service credentials.');
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function accessHeaders(
  url: string,
  origin: string,
  credentials?: AccessCredentials,
): Record<string, string> {
  if (!credentials) return {};
  const target = new URL(origin);
  if (target.protocol !== 'https:') throw new Error('Access credentials require an HTTPS origin.');
  if (new URL(url).origin !== target.origin) return {};
  return {
    'CF-Access-Client-Id': credentials.clientId,
    'CF-Access-Client-Secret': credentials.clientSecret,
  };
}

export function accessRequestOptions(
  url: string,
  origin: string,
  credentials?: AccessCredentials,
): { headers: Record<string, string>; maxRedirects: 0 } {
  return { headers: accessHeaders(url, origin, credentials), maxRedirects: 0 };
}

export async function accessFetch(
  url: string,
  origin: string,
  credentials?: AccessCredentials,
): Promise<Response> {
  // Never follow redirects with service credentials. Access redirects are authentication
  // failures; application redirects can be tested explicitly at their destination.
  return fetch(url, { headers: accessHeaders(url, origin, credentials), redirect: 'manual' });
}
