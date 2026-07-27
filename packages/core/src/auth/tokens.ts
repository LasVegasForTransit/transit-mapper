// Token primitives shared by the Worker's session and claim handling.
//
// Two encodings live here on purpose. Tokens are stored as hex SHA-256
// because that reads cleanly in a D1 console, while PKCE code challenges
// must be base64url of the raw digest — that encoding is fixed by RFC 7636,
// not a preference.

/** Base64url with padding stripped, per RFC 4648 §5. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A cryptographically random, URL-safe token. 32 bytes is 256 bits. */
export function generateToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

/** Lowercase hex SHA-256. This is what gets stored; raw tokens never are. */
export async function hashToken(token: string): Promise<string> {
  const bytes = await sha256(token);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Base64url SHA-256, the encoding PKCE requires for a code challenge. */
export async function sha256Base64Url(input: string): Promise<string> {
  return toBase64Url(await sha256(input));
}
