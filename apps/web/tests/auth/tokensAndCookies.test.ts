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

describe('tokens: generation, hashing, base64url', () => {
  it('generateToken returns a different value each call', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });
  it('generateToken is url-safe', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it('generateToken defaults to 32 bytes (43 base64url chars)', () => {
    const a = generateToken();
    expect(a.length).toBe(43);
  });
  it('generateToken honors a byte length', () => {
    expect(generateToken(16).length).toBe(22);
  });

  it('toBase64Url strips padding', () => {
    expect(toBase64Url(new Uint8Array([1, 2]))).toBe('AQI');
  });
  it('toBase64Url uses - and _ instead of + and /', () => {
    expect(toBase64Url(new Uint8Array([251, 255]))).toBe('-_8');
  });

  it('hashToken returns lowercase hex sha-256', async () => {
    // Known SHA-256 of "abc", the standard test vector.
    const abc = await hashToken('abc');
    expect(abc).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('hashToken is stable for the same input', async () => {
    const abc = await hashToken('abc');
    expect(await hashToken('abc')).toBe(abc);
  });
  it('hashToken differs for different input', async () => {
    const abc = await hashToken('abc');
    expect(await hashToken('abd')).not.toBe(abc);
  });

  it('sha256Base64Url encodes the raw digest, not the hex string', async () => {
    // Same digest, base64url-encoded rather than hex.
    expect(await sha256Base64Url('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });
});

describe('cookies: serialize and parse', () => {
  it('serializeCookie writes the attributes the session cookie needs', () => {
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
  it('serializeCookie omits Secure when not asked for', () => {
    expect(serializeCookie('tm_session', 'abc', { httpOnly: true, secure: false })).not.toContain(
      'Secure',
    );
  });
  it('serializeCookie with maxAge 0 expires the cookie', () => {
    expect(serializeCookie('tm_session', '', { maxAge: 0, path: '/' })).toBe(
      'tm_session=; Path=/; Max-Age=0',
    );
  });
  it('serializeCookie encodes values that would break the header', () => {
    expect(serializeCookie('a', 'x;y')).toMatch(/^a=x%3By/);
  });

  it('parseCookies handles a missing header', () => {
    expect(Object.keys(parseCookies(null)).length).toBe(0);
  });
  it('parseCookies reads one pair', () => {
    expect(parseCookies('tm_session=abc').tm_session).toBe('abc');
  });
  it('parseCookies reads several pairs regardless of spacing', () => {
    expect(parseCookies('a=1;b=2;  c=3').c).toBe('3');
  });
  it('parseCookies decodes encoded values', () => {
    expect(parseCookies('a=x%3By').a).toBe('x;y');
  });
  it('parseCookies ignores malformed segments rather than throwing', () => {
    expect(Object.keys(parseCookies('garbage; a=1')).length).toBe(1);
  });
});

describe('return-path validation and Google authorize URL', () => {
  it('safeReturnTo keeps a plain path', () => {
    expect(safeReturnTo('/s/abc123')).toBe('/s/abc123');
  });
  it('safeReturnTo keeps a path with a query', () => {
    expect(safeReturnTo('/?view=network')).toBe('/?view=network');
  });
  it('safeReturnTo falls back to / for null', () => {
    expect(safeReturnTo(null)).toBe('/');
  });
  it('safeReturnTo falls back to / for empty', () => {
    expect(safeReturnTo('')).toBe('/');
  });
  it('safeReturnTo rejects an absolute http url', () => {
    expect(safeReturnTo('https://evil.example')).toBe('/');
  });
  it('safeReturnTo rejects a protocol-relative url', () => {
    expect(safeReturnTo('//evil.example')).toBe('/');
  });
  it('safeReturnTo rejects a backslash protocol-relative url', () => {
    expect(safeReturnTo('/\\evil.example')).toBe('/');
  });
  it('safeReturnTo rejects anything not starting with /', () => {
    expect(safeReturnTo('s/abc')).toBe('/');
  });
  it('safeReturnTo rejects a javascript url', () => {
    expect(safeReturnTo('javascript:alert(1)')).toBe('/');
  });
  it('safeReturnTo rejects embedded control characters', () => {
    expect(safeReturnTo('/a\nb')).toBe('/');
  });

  describe('buildAuthorizeUrl', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'cid',
        redirectUri: 'https://example.test/auth/google/callback',
        state: 'st',
        codeChallenge: 'cc',
      }),
    );

    it('buildAuthorizeUrl targets Google', () => {
      expect(url.host).toBe('accounts.google.com');
    });
    it('buildAuthorizeUrl asks for a code', () => {
      expect(url.searchParams.get('response_type')).toBe('code');
    });
    it('buildAuthorizeUrl passes the client id', () => {
      expect(url.searchParams.get('client_id')).toBe('cid');
    });
    it('buildAuthorizeUrl passes the redirect uri', () => {
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://example.test/auth/google/callback',
      );
    });
    it('buildAuthorizeUrl passes the state', () => {
      expect(url.searchParams.get('state')).toBe('st');
    });
    it('buildAuthorizeUrl passes the code challenge', () => {
      expect(url.searchParams.get('code_challenge')).toBe('cc');
    });
    it('buildAuthorizeUrl uses the S256 challenge method, never plain', () => {
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });
    it('buildAuthorizeUrl requests only identity scopes', () => {
      expect(url.searchParams.get('scope')).toBe('openid email profile');
    });
  });
});
