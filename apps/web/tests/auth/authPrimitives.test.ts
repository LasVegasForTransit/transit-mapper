import { describe, expect, it } from 'vitest';
import {
  generateToken,
  hashToken,
  sha256Base64Url,
  toBase64Url,
} from '@transitmapper/core/auth/tokens';
import { parseCookies, serializeCookie } from '@transitmapper/core/auth/cookies';
import { safeReturnTo } from '@transitmapper/core/auth/returnTo';
import { buildAuthorizeUrl } from '@transitmapper/core/auth/google';

describe('generating and hashing session tokens', () => {
  it('a generated token is different every time', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });
  it('a generated token is safe to drop straight into a url', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('a token defaults to 32 bytes, 43 base64url characters', () => {
    const a = generateToken();
    expect(a.length).toBe(43);
  });
  it('a token can be generated at a chosen byte length', () => {
    expect(generateToken(16).length).toBe(22);
  });

  it('base64url encoding strips the padding', () => {
    expect(toBase64Url(new Uint8Array([1, 2]))).toBe('AQI');
  });
  it('base64url encoding swaps in url-safe characters for + and /', () => {
    expect(toBase64Url(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('hashing a token gives lowercase hex sha-256', async () => {
    // Known SHA-256 of "abc", the standard test vector.
    const abc = await hashToken('abc');
    expect(abc).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('the same token always hashes to the same value', async () => {
    const abc = await hashToken('abc');
    expect(await hashToken('abc')).toBe(abc);
  });
  it('a different token hashes to a different value', async () => {
    const abc = await hashToken('abc');
    expect(await hashToken('abd')).not.toBe(abc);
  });

  it('the base64url digest is the raw hash, not its hex spelling', async () => {
    // Same digest, base64url-encoded rather than hex.
    expect(await sha256Base64Url('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });
});

describe('reading and writing the session cookie', () => {
  it('serializing writes every attribute the session cookie needs', () => {
    expect(
      serializeCookie('tm_session', 'abc', {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 60,
      }),
    ).toBe('tm_session=abc; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax');
  });
  it('a cookie not marked secure omits Secure', () => {
    expect(serializeCookie('tm_session', 'abc', { httpOnly: true, secure: false })).not.toContain(
      'Secure',
    );
  });
  it('a max-age of zero expires the cookie', () => {
    expect(serializeCookie('tm_session', '', { maxAge: 0, path: '/' })).toBe(
      'tm_session=; Path=/; Max-Age=0',
    );
  });
  it('a value that would break the header gets encoded', () => {
    expect(serializeCookie('a', 'x;y')).toMatch(/^a=x%3By/);
  });

  it('a missing cookie header parses to nothing', () => {
    expect(Object.keys(parseCookies(null)).length).toBe(0);
  });
  it('a single pair parses back out', () => {
    expect(parseCookies('tm_session=abc').tm_session).toBe('abc');
  });
  it('several pairs parse regardless of spacing', () => {
    expect(parseCookies('a=1;b=2;  c=3').c).toBe('3');
  });
  it('an encoded value decodes back to plain text', () => {
    expect(parseCookies('a=x%3By').a).toBe('x;y');
  });
  it('a malformed segment is skipped rather than thrown on', () => {
    expect(Object.keys(parseCookies('garbage; a=1')).length).toBe(1);
  });
});

describe('keeping a post-login redirect on our own site', () => {
  it('a plain path is kept as-is', () => {
    expect(safeReturnTo('/s/abc123')).toBe('/s/abc123');
  });
  it('a path carrying a query string is kept as-is', () => {
    expect(safeReturnTo('/?view=network')).toBe('/?view=network');
  });
  it('no return path falls back to /', () => {
    expect(safeReturnTo(null)).toBe('/');
  });
  it('an empty return path falls back to /', () => {
    expect(safeReturnTo('')).toBe('/');
  });
  it('an absolute http url is rejected, not followed off-site', () => {
    expect(safeReturnTo('https://evil.example')).toBe('/');
  });
  it('a protocol-relative url is rejected the same way', () => {
    expect(safeReturnTo('//evil.example')).toBe('/');
  });
  it('a backslash-disguised protocol-relative url is rejected too', () => {
    expect(safeReturnTo('/\\evil.example')).toBe('/');
  });
  it('anything not starting with / is rejected', () => {
    expect(safeReturnTo('s/abc')).toBe('/');
  });
  it('a javascript: url is rejected', () => {
    expect(safeReturnTo('javascript:alert(1)')).toBe('/');
  });
  it('embedded control characters are rejected', () => {
    expect(safeReturnTo('/a\nb')).toBe('/');
  });
});

describe('building the Google OAuth authorize URL', () => {
  const url = new URL(
    buildAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'https://example.test/auth/google/callback',
      state: 'st',
      codeChallenge: 'cc',
    }),
  );

  it('it targets Google', () => {
    expect(url.host).toBe('accounts.google.com');
  });
  it('it asks for a code', () => {
    expect(url.searchParams.get('response_type')).toBe('code');
  });
  it('it carries the client id', () => {
    expect(url.searchParams.get('client_id')).toBe('cid');
  });
  it('it carries the redirect uri', () => {
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.test/auth/google/callback');
  });
  it('it carries the state', () => {
    expect(url.searchParams.get('state')).toBe('st');
  });
  it('it carries the code challenge', () => {
    expect(url.searchParams.get('code_challenge')).toBe('cc');
  });
  it('it insists on the S256 challenge method, never plain', () => {
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
  it('it requests only identity scopes', () => {
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });
});
