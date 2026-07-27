// Pure parts of the Google OAuth flow. Anything that performs a fetch lives
// in apps/worker/src/auth/google.ts instead, so the URL construction stays
// checkable by `pnpm verify`.

export const GOOGLE_AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Identity only. Widening this asks people for access we have no use for. */
export const GOOGLE_SCOPE = 'openid email profile';

export interface AuthorizeUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
  /** Base64url SHA-256 of the PKCE verifier — see sha256Base64Url. */
  codeChallenge: string;
}

export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const url = new URL(GOOGLE_AUTHORIZE_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', GOOGLE_SCOPE);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  // S256 only. The spec permits "plain", which defeats the point of PKCE.
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}
