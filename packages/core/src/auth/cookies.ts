// Cookie helpers. The Workers runtime gives you raw Set-Cookie strings and a
// raw Cookie header, with no parsing either way, so both directions live here
// where `pnpm verify` can exercise them.

export interface CookieOptions {
  /** Seconds. 0 expires the cookie immediately. */
  maxAge?: number;
  httpOnly?: boolean;
  /** Omitted on http://localhost — browsers drop Secure cookies on insecure
   *  origins, which would make local sign-in fail with no visible error. */
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const segment of header.split(';')) {
    const eq = segment.indexOf('=');
    if (eq < 1) continue; // no name, or no separator — skip rather than throw
    const name = segment.slice(0, eq).trim();
    const raw = segment.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw; // a value that isn't valid percent-encoding is used as-is
    }
  }
  return out;
}
