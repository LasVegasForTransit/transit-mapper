# Secrets

Every secret this project uses, what it can do if it leaks, and how to
replace it. If you add one, it goes here in the same change.

The list is short on purpose, and keeping it short is the point. Track 10
of the harness spec adds the automation described at the bottom; this page
is accurate as of today either way.

## Inventory

| Secret                  | Lives in                                       | Blast radius if leaked                                             |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | GitHub `production` and `preview` environments | Deploy Worker code, alter D1 data, and replace managed R2 archives |
| `CLOUDFLARE_ACCOUNT_ID` | The same two environments, as a variable       | Not a secret. An identifier, useless without a token               |

The same token in both environments, and this is not an oversight. Cloudflare
has no per-script API token scope: any token that can deploy a pull request
preview Worker can also overwrite the production one. The `preview`
environment gives previews their own deployment records and somewhere to put a
narrower token the day Cloudflare offers one. It is not an isolation boundary.
What keeps the token away from unreviewed code is that previews run only for
branches pushed to this repository, which already requires write access — see
[pull request previews](../../development/explanation/preview-deployments.md).

`CLOUDFLARE_ACCOUNT_ID` is an environment variable rather than a repository
variable. Every workflow that reads it does so from inside a job that names an
environment, so either scope would work — but an environment variable does not
reach a job that does not name that environment. The preview workflow reads it
from three separate jobs, and each one names `preview` for that reason.

**There are no application secrets in production.** The Worker reads
`SITE_URL` (a plain var) plus platform bindings for assets, D1, R2, rate
limits, and the place-search coordinator. Rate-limit namespace ids and R2
bucket names are configuration, not credentials.

## Anonymous performance data boundary

`POST /api/performance-samples` accepts sampled loading timings, Core Web
Vitals, encoded byte categories, coarse cache/service-worker/device/network
states, the release build id, editor/share/embed surface, and a fixed
capability bitset. It never accepts or stores share or document ids and names,
URLs, origins, coordinates, content, input, IP addresses, or user-agent
strings. D1 has no column that can hold those values and the Worker never
stores the submitted JSON object.

The browser constructs that allowlist only in release-tagged production builds
on the configured live origin. A build-scoped session-storage value is only
`0` or `1`; blocked storage uses page memory, and the random word is never
persisted or sent. GPC and both browser DNT properties are evaluated before a
`PerformanceObserver` exists. The public no-JavaScript privacy policy states
the sampling rates, purpose, processor, seven-day raw and 90-day aggregate
retention, recovery caveat, and exact never-collected categories.

Cloudflare supplies `CF-Connecting-IP` to the Worker. That address is used
transiently as the platform rate limiter's key (ten samples per minute) and is
not copied into D1 or logs. Global Privacy Control (`Sec-GPC: 1`) and Do Not
Track (`DNT: 1`) make the endpoint return before reading or storing the body.
Storage errors are logged as operational failures but telemetry cannot fail a
page-close request.

Cloudflare necessarily handles request metadata to deliver and protect the
site. That processor boundary is distinct from the application performance
tables: the tables do not copy request IPs, headers, URLs, or raw user agents.

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
| 1   | `.githooks/pre-commit` | yes, via `--no-verify`               |
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
