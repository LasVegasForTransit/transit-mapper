# Set up production from scratch

This page takes you from nothing to a TransitMapper that deploys itself on
every release. It is also how you check an existing setup: the same command
reports what is already done and changes nothing.

Most of the work is done by one command, `pnpm bootstrap`. It creates what is
missing, asks before it creates anything, and stops to show you exactly what
to type whenever it needs a value only a dashboard can give you. The sections
below repeat those steps, so you can read them before you start or follow them
by hand.

## Before you start

Everything TransitMapper runs on belongs to Las Vegans for Better Transit, not
to a person. The Cloudflare account is named **Las Vegas for Better Transit**
(account ID `2557b5c2e166292ded0f8425b73075e9`), and the code lives in the
**LasVegasForTransit** GitHub organization. Nothing in this guide should be
created under a personal account.

You need:

- a Cloudflare login that is a member of the Las Vegas for Better Transit
  account;
- admin access to the `LasVegasForTransit/transit-mapper` repository on
  GitHub, because only admins can change its environments and rules;
- a checkout set up as described in
  [local development](../../development/how-to/local-development.md), with
  the GitHub CLI (`gh`) installed.

Wrangler, the Cloudflare command-line tool, comes with the repository, so you
do not install it separately.

## Run the bootstrap

1. Open a terminal in your checkout of the repository.
2. Run `pnpm install --frozen-lockfile` if you have not already.
3. Run `pnpm bootstrap`.
4. When it asks you to log in to GitHub or Cloudflare, say yes. A browser
   window opens; log in there and come back to the terminal.
5. If it asks to create a D1 database, say yes. `transitmapper` holds the
   live site's shared maps and `transitmapper-preview` holds those of pull
   request previews. A database that already exists is used as it is.
6. When it asks to apply the organization governance standard, say yes. This
   turns on branch protection, secret scanning and the other repository
   rules, and creates the `production` and `preview` GitHub environments.
7. When it asks to write the CI credentials, say yes, then follow
   [make the deploy token](#make-the-deploy-token) and paste the token.
8. When it asks for the Web Analytics tokens, follow
   [find the Web Analytics tokens](#find-the-web-analytics-tokens) and paste
   each one.
9. If the bootstrap says it wrote a database id into
   `apps/worker/wrangler.toml`, commit that file on a new branch and open a
   pull request. The deploys read the file from the main branch, so the new
   id does nothing until the pull request is merged. The bootstrap never
   commits or pushes for you.
10. Run `pnpm bootstrap` once more. Every line should show a check mark, and
    it should ask you nothing.

## What each value is

### `CLOUDFLARE_API_TOKEN`

This token lets GitHub Actions deploy the Worker, apply database migrations,
and refresh the GTFS archives. It is a secret. The bootstrap stores it as an
environment secret on both the `production` and `preview` GitHub
environments and nowhere else. It is a long string of letters, digits and
symbols that Cloudflare shows only once. It is never fine to skip: without it
the release deploy fails and pull requests get no preview.

### `CLOUDFLARE_ACCOUNT_ID`

This tells the workflows which Cloudflare account to deploy to. It is not a
secret. The bootstrap sets it as an environment variable on both environments
from the `account_id` line in `apps/worker/wrangler.toml`, so you never copy
it. It is 32 letters and digits: `2557b5c2e166292ded0f8425b73075e9`.

### `PUBLIC_LVBT_CWA_TOKEN` and `PUBLIC_LVBT_LABS_CWA_TOKEN`

These are the Cloudflare Web Analytics tokens for `map.lasvegasfortransit.org`
and `labs.lasvegasfortransit.org`. They are public, because every page view
sends them, so the bootstrap stores them as environment variables on the
`production` environment. Each is 32 letters and digits. Do not skip them:
the production build refuses to deploy without them. What they measure is in
[analytics](analytics.md).

### The D1 database ids

Each database has an id like `5516498a-4473-468e-a1c9-a9dee4762960`. They are
not secret and are committed in `apps/worker/wrangler.toml`. The bootstrap
writes them for you; your only job is the pull request in step 9.

## Make the deploy token

1. Open <https://dash.cloudflare.com/profile/api-tokens> and click
   **Create Token**.
2. Next to **Edit Cloudflare Workers**, click **Use template**.
3. Name the token `map.lasvegasfortransit.org deploy (GitHub Actions)`.
4. Under Permissions, check that the template has these eight rows, and keep
   them all: Account · Workers Scripts · Edit, Account · Workers KV Storage ·
   Edit, Account · Workers R2 Storage · Edit, Account · Workers Tail · Read,
   Account · Account Settings · Read, Zone · Workers Routes · Edit, User ·
   User Details · Read, and User · Memberships · Read.
5. Add one more permission row and set it to Account · D1 · Edit. Every
   deploy and every preview applies database migrations, and the template
   does not include D1.
6. Under Account Resources, choose Include and then **Las Vegas for Better
   Transit**. Do not choose "All accounts".
7. Under Zone Resources, choose Include, then Specific zone, then
   `lasvegasfortransit.org`.
8. Leave TTL empty, so deploys keep working.
9. Click **Continue to summary**, then **Create Token**.
10. Copy the token. Cloudflare shows it only once. Paste it into the
    terminal when the bootstrap asks; it is not shown as you type.

The token is created from your own Cloudflare profile, but it can reach only
the Las Vegas for Better Transit account. The daily GTFS refresh needs
Account · Workers R2 Storage · Edit, which the template already grants, so
there is nothing to add for it.

If the token is ever rolled or deleted in Cloudflare, the stored copy stops
working and every deploy fails. Make a new token with the steps above and
store it with `pnpm bootstrap --rotate-token`.

## Find the Web Analytics tokens

Do this once for `map.lasvegasfortransit.org` and once for
`labs.lasvegasfortransit.org`.

1. Open
   <https://dash.cloudflare.com/2557b5c2e166292ded0f8425b73075e9/web-analytics>.
2. If the hostname is already listed, click **Manage site** on it and go to
   step 5.
3. Click **Add a site** and type the hostname.
4. Choose **Enable with JS Snippet installation**, not the automatic
   **Enable** option. The site loads the analytics script itself.
5. In the JS snippet, copy only the token inside
   `data-cf-beacon='{"token": "..."}'`. It is 32 letters and digits.
6. Paste it into the terminal when the bootstrap asks for that hostname.

## Running it again

You can run `pnpm bootstrap` as often as you like. Each step checks first
and acts only on what is missing, so a run on a finished setup changes
nothing, asks nothing, and reports every line ready. A run after one that
stopped partway picks up where that one stopped.

On a second run the bootstrap does not ask for a secret that is already set,
and does not create a second database, ruleset or environment. It does not
rewrite `wrangler.toml` unless a database id actually changed. It applies
database migrations only when some are pending. For a database it created in
the same run it applies them straight away; for any other database it lists
them and asks first, because the migrations come from your checkout.

`pnpm preflight` runs the same checks and only reports. It never installs,
creates, writes or asks anything.

## Replacing a value

The bootstrap never replaces a value that is already set unless you ask for
it with a flag.

To replace a leaked or rolled deploy token:

1. Make a new token with the steps in
   [make the deploy token](#make-the-deploy-token).
2. Run `pnpm bootstrap --rotate-token` and paste it.
3. Wait for the next deploy to succeed, then delete the old token on
   <https://dash.cloudflare.com/profile/api-tokens>.

If the bootstrap reports that `CLOUDFLARE_ACCOUNT_ID` holds a different
account from the one in `apps/worker/wrangler.toml`, find out which one is
right before changing anything. If `wrangler.toml` is right, run
`pnpm bootstrap --replace-account-id`.

To change a Web Analytics token, open the repository on GitHub, go to
**Settings → Environments → production**, and edit the variable under
**Environment variables**.

## Not covered by the bootstrap

Pull request previews also need the account's `workers.dev` subdomain to be
registered once. If the preview workflow fails at **Resolve the preview
target**, follow
[when a preview fails](operations.md#when-a-preview-fails).
