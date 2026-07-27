# Accounts and permanent shares

## Context

Anonymous shares expire seven days after creation. That policy was set in
[the share-expiry design](2026-07-21-share-expiry-design.md), which
deliberately made `expires_at` nullable and reserved `NULL` to mean "never
expires" for a future account system.

Phase 1 of the roadmap adds rich link previews and embeddable maps. Both
assume a share URL keeps working: a map embedded in a blog post that returns
404 after a week is worse than no embed. One proposed stopgap was a sliding
window, where any view pushes `expires_at` out another seven days. This spec
implements the real fix instead. A signed-in user's shares have
`expires_at = NULL` and never expire, and the sliding window is not built.

## Goals

- A person can sign in with Google.
- Shares created while signed in never expire.
- Shares created anonymously in the same browser can be adopted on sign-in,
  keeping their existing URLs, so links already pasted elsewhere survive.
- A signed-in person can see and delete the shares they own.
- Anonymous behavior is unchanged: no account required to share, still seven
  days.

## Non-goals

- Server-side storage of editable systems. Systems stay in `localStorage`.
  There is no sync, no multi-device library, and no conflict resolution.
- Any social feature. No profiles, comments, likes, follows, ActivityPub, or
  real-time collaboration. Those depend on this work but are separate
  projects.
- Email/password sign-in, magic links, and multi-factor authentication.
- Account linking across providers. See "Deliberate omissions."
- The sliding-window TTL. It is not built, now or later.

## Architecture

### What an account is for

The server stores immutable snapshots and nothing else. That does not change
here. An account attaches an owner to a snapshot, which has two effects: the
snapshot stops expiring, and it appears in a list the owner can act on.

Everything a person edits still lives in their browser. This is the point
users are most likely to misread, so the how-to guide states it directly:
signing in does not back up your work.

### Ownership rule

A share row with a non-null `owner_id` has `expires_at = NULL`. A share row
with a null `owner_id` has a concrete `expires_at`. The two fields move
together and are only ever written together, in `POST /api/systems` and in
the claim handler.

## Schema

New migration `apps/worker/src/migrations/0003_accounts.sql`.

```sql
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  name       TEXT,
  image      TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  account_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (provider_id, account_id)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

ALTER TABLE systems ADD COLUMN owner_id   TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE systems ADD COLUMN claim_hash TEXT;

CREATE INDEX systems_owner_id ON systems(owner_id);
CREATE INDEX sessions_expires_at ON sessions(expires_at);
```

Column notes, which belong in the migration file as comments as well:

- `users.email` is profile data used to label the account in the UI. It is
  not identity, and it is not unique. People change the email on a Google
  account, and the provider's subject identifier does not change with it.
- `accounts` holds one row per linked provider identity. Only `google` exists
  today. `account_id` is the provider's subject claim (`sub`).
- `sessions.token_hash` is the SHA-256 of the cookie value. The raw token is
  never stored. Someone with read access to the database cannot mint a cookie
  from it.
- `systems.claim_hash` is the SHA-256 of a one-time claim secret handed to
  the creator of an anonymous share. It is set to `NULL` when the share is
  adopted, so a share can be claimed once.
- `systems.owner_id` cascades on user deletion. Deleting an account deletes
  the shares it owns, which is what someone deleting their account expects.
  There is no account-deletion UI in this project; the constraint defines
  correct behavior for a manual deletion.

This schema follows better-auth's `user` / `session` / `account` shape so
replacing the hand-written implementation with that library later stays
cheap. Two deviations are deliberate:

1. better-auth stores session tokens in plaintext. Storing the hash costs one
   Web Crypto call per authenticated request. Adopting better-auth later would
   invalidate existing sessions once, and everyone would sign in again.
2. better-auth marks `user.email` unique. Keying identity on
   `(provider_id, account_id)` instead avoids a migration if a second provider
   is ever added.

## Sign-in flow

Google OAuth 2.0 authorization code flow with PKCE, written directly in
`apps/worker/src/auth/`.

### Routes

Two endpoints exist for browser navigation. They return redirects and set
cookies, and no API client calls them, so they are mounted outside `/api`.

| Route                       | Behavior                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /auth/google`          | Generate `state` and a PKCE verifier, store both in short-lived cookies, redirect to Google.                 |
| `GET /auth/google/callback` | Verify `state`, exchange the code, resolve the profile, upsert user and account, create a session, redirect. |

### Start

`GET /auth/google` generates 32 random bytes for `state` and a PKCE
`code_verifier`, then sets three cookies with a 10-minute `Max-Age`:
`tm_oauth_state`, `tm_oauth_verifier`, and `tm_oauth_return`. It redirects to
Google's authorization endpoint with `code_challenge_method=S256`, scope
`openid email profile`.

`tm_oauth_return` holds where to send the person afterward, taken from a
`returnTo` query parameter. It is validated to start with a single `/`. A
value beginning with `//` is a protocol-relative URL pointing at another host
and is rejected, falling back to `/`.

These cookies use `SameSite=Lax` rather than `Strict`. The callback arrives
as a top-level GET navigation from Google's origin. `Lax` sends cookies on
that navigation and `Strict` does not, so `Strict` would break the flow.

### Callback

`GET /auth/google/callback`:

1. Compares the `state` query parameter against the `tm_oauth_state` cookie.
   A mismatch or a missing cookie returns 400. This is the standard
   double-submit check, and because the comparison is against a value the
   browser holds, it needs no server-side signing key. The design owns no
   secret of its own beyond the Google client secret.
2. Exchanges the authorization code at Google's token endpoint, sending the
   `code_verifier`.
3. Calls Google's userinfo endpoint with the resulting access token to get
   `sub`, `email`, `name`, and `picture`.
4. Looks up `accounts` by `(provider_id, account_id)`. A hit reuses the
   existing user. A miss creates a `users` row and an `accounts` row.
5. Creates a session and sets the session cookie.
6. Clears the three OAuth cookies and redirects to the validated return path.

Step 3 uses the userinfo endpoint rather than decoding the ID token. The ID
token would have to be checked for `iss` and `aud` and would need JWT
handling. One extra HTTPS request avoids all of that, and the code stays
readable by someone who has not implemented OIDC before.

### Session cookie

```
tm_session=<32 random bytes, base64url>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000
```

`Secure` is added whenever the request URL is `https`. It is omitted on
`http://localhost` because browsers drop `Secure` cookies on insecure
origins, which would make local development silently fail.

Sessions last 30 days. A request made when fewer than 7 days remain extends
the row, so an active user is not signed out mid-use. That is at most one
write per week per session.

`SameSite=Lax` means the session cookie is not sent inside a third-party
iframe. Embedded maps are anonymous read-only views and need no session, so
this is correct, but it is stated in the docs because embeds are the feature
that motivated this work.

### Configuration

`GOOGLE_CLIENT_ID` is a `wrangler.toml` var. `GOOGLE_CLIENT_SECRET` is a
Wrangler secret, and a gitignored `apps/worker/.dev.vars` locally.

When either is missing, `/auth/*` returns 503 and `GET /api/auth/providers`
returns an empty list, which makes the UI hide sign-in. Most contributors will
never configure Google credentials, and the project already treats the backend
as optional in local development.

## API

`/api` holds REST resources. The action is carried by the HTTP method, and
collections are filtered with query parameters.

| Route                        | Behavior                                         |
| ---------------------------- | ------------------------------------------------ |
| `GET /api/auth/providers`    | Sign-in providers currently available.           |
| `GET /api/session`           | The current session's user. 404 when signed out. |
| `DELETE /api/session`        | End the session. 204 on success.                 |
| `GET /api/systems?owner=me`  | Shares owned by the current user.                |
| `POST /api/systems`          | Create a snapshot.                               |
| `GET /api/systems/:id`       | Read a snapshot. Unchanged.                      |
| `PUT /api/systems/:id/owner` | Claim an anonymous share.                        |
| `DELETE /api/systems/:id`    | Delete a share. Owner only.                      |

`GET /api/systems` without a filter returns 400. The collection is never
enumerable, and `owner=me` is the only supported filter.

`GET /api/session` returns 404 when there is no session, because the resource
does not exist. The client treats 404 as signed out. A 200 carrying
`{ "user": null }` would have read more conveniently, but it makes a missing
resource look like a present one.

`GET /api/auth/providers` returns the providers that are configured and
usable, as `{ "providers": [{ "id": "google", "name": "Google",
"startUrl": "/auth/google" }] }`. The list is empty when no credentials are
configured, which is how the client decides whether to show sign-in at all.
This is a real collection rather than a status check, and it is what a second
provider would be added to.

### Changes to `POST /api/systems`

Signed in: `owner_id` is the current user, `expires_at` is `NULL`, and
`claim_hash` is `NULL`.

Anonymous: `owner_id` is `NULL`, `expires_at` is `now + 7 days`, and a
128-bit claim secret is generated. Its hash is stored and the secret is
returned once in the response as `claimToken`.

`CreateShareResponse` in `packages/core/src/share/contract.ts` gains an
optional `claimToken`.

### State-changing requests

Every state-changing `/api` request checks that the `Origin` header matches
the site origin, rejecting mismatches with 403. `SameSite=Lax` already
prevents the session cookie from riding along on a cross-site `POST`,
`PUT`, or `DELETE`. The origin check is a second, independent barrier that
does not depend on browser cookie policy being correct.

## Claim flow

A browser records `{ id, claimToken }` for every anonymous share it creates,
in a `transitmapper:shares` localStorage key.

After a successful sign-in, the client issues one request per held share:

```
PUT /api/systems/:id/owner
{ "claimToken": "..." }
```

The handler runs:

```sql
UPDATE systems
   SET owner_id = ?, expires_at = NULL, claim_hash = NULL
 WHERE id = ? AND claim_hash = ? AND owner_id IS NULL
```

Responses are 200 with the updated share, 403 for a bad or spent token, and
409 when the share already has an owner. The client drops entries that
resolve to 403 or 409, since neither will ever succeed on a retry.

`PUT` is correct here because the operation is idempotent in effect: the
owner ends up set to the current user, and replaying the request changes
nothing. Doing this per share rather than as one batch call means a single
bad token cannot fail the others.

Two credentials are required. The session cookie establishes who is
claiming, and the claim token proves they created the share. Possession of a
share URL alone is not enough, which matters because otherwise anyone who
saw a link could take ownership of it and then delete it.

## Anonymous expiry

Unchanged: seven days from creation, never extended. The lazy delete on read
and the daily cron sweep both keep working, because owned rows have a null
`expires_at` and the sweep already filters on `expires_at IS NOT NULL`.

The cron handler gains a second statement deleting sessions whose
`expires_at` has passed.

## User interface

### Sign in and out

`FileMenu` gains an item. Signed out, it reads "Sign in with Google" and
navigates to the provider's `startUrl` with `?returnTo=<current path>`.
Signed in, it shows the account email, "My shares", and "Sign out". The item
is hidden entirely when `GET /api/auth/providers` returns an empty list.

Session state is read once on load through a small `useSession` hook in
`apps/web/src/auth/`, which also drives the claim requests after sign-in.

### My shares

`MySharesDialog` follows `SystemsDialog`'s existing structure: the same
`Modal`, the same `relativeTime` helper, the same row layout. Each row shows
the system name, when it was shared, a copy-link action, an open action, and
a delete action with the same confirm-in-place pattern `SystemsDialog`
already uses.

### Share dialog

`ShareDialog` currently calls `createShare` when it opens, so opening the
dialog writes a database row. That is a write performed as a side effect of a
read, and with accounts it also fills "My shares" with near-duplicates every
time someone reopens the dialog.

The dialog will instead show the most recent link already created for the
current system, if the browser has one, with an explicit action to create a
new link. Behavior is the same signed in or out. Snapshots stay immutable: a
new link is a new frozen snapshot, and existing links keep pointing at what
they always pointed at.

The dialog also states the expiry: "This link won't expire" when signed in,
or "This link expires in 7 days" with a sign-in action when not.

This change is separable from the rest of the work and is sequenced as its
own step in the implementation plan.

## Deliberate omissions

**Account linking.** A returning person is matched only on
`(provider_id, account_id)`. Matching on email instead is a known
account-takeover path when a provider does not verify addresses, and with a
single provider it gains nothing. If a second provider is added, linking
needs its own decision, and the rule should be to link only when both
providers report a verified email.

**Sign out everywhere.** `DELETE /api/session` ends the current session.
Ending every session for a user is one statement away but has no interface,
and no interface is proposed here.

**Rate limiting on claims.** Claim secrets are 128 bits, so guessing one is
not a practical attack. Share creation is already unauthenticated and
unlimited, and this work does not make that worse.

## Documentation

Required as part of the implementation, not afterward.

- `docs/explanation/accounts-and-sessions.md`, new. The sign-in flow, the
  session lifecycle, the three tables and what each one is for, the ownership
  rule, why the implementation is hand-written, and why sessions live in D1.
- `docs/how-to/accounts.md`, new. How to sign in, what permanence means, and
  the point people will get wrong: systems still live in the browser, and
  signing in is not a backup.
- `docs/how-to/share-and-export.md`, updated for expiry and permanence.
- `docs/reference/project-structure.md`, updated for `apps/worker/src/auth/`
  and `apps/web/src/auth/`.
- `docs/how-to/local-development.md`, updated for the Google credentials and
  the fact that sign-in is optional locally.
- `ROADMAP.md`, updated for the reordering described below.

## Roadmap ordering

The roadmap places accounts in Phase 3 and states that phases run in order
unless there is a deliberate reason to reorder. The deliberate reason is that
Phase 1 ships embeddable maps and rich link previews, and both are worth
little on URLs that stop working after a week.

Accounts and permanent shares move into Phase 1. Real-time collaboration
stays in Phase 3, which is renamed to reflect what remains in it. The Phase 3
line promising sign-in with "Google or GitHub" becomes Google only: the
people who need a share link to keep working are riders and advocates, and
asking them to create a developer account to keep a map alive serves nobody.

## Testing

`pnpm verify` runs without a browser or network and cannot reach the Worker.
Rather than adding a second test framework, pure logic moves into
`packages/core/src/share/` where the existing harness reaches it:

- The expiry rule: given an owner or no owner, what `expires_at` and
  `claim_hash` a new share gets.
- The claim-response reducer: given a set of held shares and a set of per-
  share results, which entries stay in local storage.
- The `returnTo` validator, including `//evil.example` and absolute URLs.
- The local shares store: recording, reading, and dropping entries.

The OAuth round trip, cookie attributes, and D1 statements are verified by
hand against `wrangler dev`, using a checklist recorded in the implementation
plan:

- Sign in from a clean browser, confirm a `users` row, an `accounts` row, and
  a `sessions` row, and confirm the cookie is `HttpOnly`.
- Create a share while signed in, confirm `expires_at IS NULL` and
  `owner_id` set.
- Create a share signed out, sign in, confirm the row is adopted in place and
  the URL still resolves.
- Replay a claim for an already-owned share, confirm 409.
- Claim with a wrong token, confirm 403 and that the row is untouched.
- Sign out, confirm the session row is gone and `GET /api/session` returns 404.
- Delete a share owned by someone else, confirm 403.
- Run the scheduled handler with a mix of expired and permanent rows, confirm
  only expired anonymous rows and expired sessions are removed.
