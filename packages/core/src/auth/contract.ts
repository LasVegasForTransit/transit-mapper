// Wire shapes for the account endpoints, imported by both the React client
// and the Worker so the two can't drift.

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/** Body of GET /api/session. The route 404s when there is no session, so
 *  this shape only ever describes a signed-in response. */
export interface SessionResponse {
  user: SessionUser;
}

export interface AuthProvider {
  id: string;
  name: string;
  /** Where to send the browser to begin. Outside /api: it redirects. */
  startUrl: string;
}

/** Body of GET /api/auth/providers. Empty when no credentials are
 *  configured, which is how the client decides to hide sign-in entirely. */
export interface AuthProvidersResponse {
  providers: AuthProvider[];
}

/** Body of PUT /api/systems/:id/owner. */
export interface ClaimRequest {
  claimToken: string;
}

export interface OwnedShare {
  id: string;
  name: string;
  createdAt: number;
}

/** Body of GET /api/systems?owner=me. */
export interface OwnedSharesResponse {
  shares: OwnedShare[];
}
