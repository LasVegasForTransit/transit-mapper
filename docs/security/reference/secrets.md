# Secrets

Every secret this project uses, what it can do if it leaks, and how to
replace it. If you add one, it goes here in the same change.

The list is short on purpose, and keeping it short is the point. Track 10
of the harness spec adds the automation described at the bottom; this page
is accurate as of today either way.

## Inventory

| Secret                  | Lives in                        | Blast radius if leaked                                               |
| ----------------------- | ------------------------------- | -------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | GitHub `production` environment | Deploy arbitrary code to the Worker and read or drop the D1 database |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub repository variable      | Not a secret. An identifier, useless without a token                 |

**There are no application secrets in production.** The Worker reads
`SITE_URL` (a plain var) and the `ASSETS` and `SHARE_CREATE_LIMITER`
bindings. Nothing else.

Accounts will add exactly one, `GOOGLE_CLIENT_SECRET`, as a Wrangler
secret. That design deliberately owns no signing key of its own — it uses
PKCE with cookie-held verifiers — so one secret is the whole cost.

## Rotation

Assume anything written down is burned. Rotating is cheap; deciding
whether it was really exposed is not.

1. **Rotate first, investigate second.** Create the replacement, install
   it, then revoke the old one.
2. For `CLOUDFLARE_API_TOKEN`: create a new token in the Cloudflare
   dashboard scoped the same way, set it on the GitHub `production`
   environment, confirm a deploy succeeds, then delete the old token.
3. Removing the value from a file does not remove it from git history. If
   it was committed and pushed, treat it as public regardless of what you
   do to the history afterwards.

## Prevention

Three nets, because the first two can be skipped:

| Net | Where                  | Bypassable                           |
| --- | ---------------------- | ------------------------------------ |
| 1   | `.githooks/pre-commit` | yes — `--no-verify`, by design       |
| 2   | CI, `Scan for secrets` | no, but only once a branch is pushed |
| 3   | GitHub push protection | no, blocks at the remote             |

Net 1 needs the `gitleaks` binary locally. Without it the hook says so and
continues; it does not pretend to have scanned. Install with
`brew install gitleaks`.

**Net 3 is a repository setting and is not yet enabled.** It is free on
public repositories and is turned on with the rest of the repository
governance in track 5.

## Rules

- Never pass a secret as a command-line argument. It lands in shell history
  and in the transcript of any agent that ran the command.
  `wrangler secret put NAME` reads from stdin for this reason.
- Local development needs no secrets at all. The editor runs fully without
  the backend, and anyone working on authentication uses a _development_
  OAuth application with its own client secret.
- No developer and no agent holds a production credential.
