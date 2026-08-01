# Security

## Reporting a vulnerability

Email **security@lasvegasfortransit.org** with what you found and how to
reproduce it. Please do not open a public issue for anything exploitable.

You should get an acknowledgement within a few days. This is a small
volunteer team, so a fix may take longer than that — we would rather tell
you honestly where it stands than go quiet.

If you would prefer to report through GitHub, use
[private vulnerability reporting](https://github.com/LasVegasForTransit/transit-mapper/security/advisories/new).

## Supported versions

TransitMapper is in open beta. Security fixes are applied to the version
running at [map.lasvegasfortransit.org](https://map.lasvegasfortransit.org)
and the current `main` branch. Older commits, forks, and exported system data
do not receive security updates.

## What is in scope

TransitMapper stores systems that anyone can create without an account, and
serves them back to anyone with the link. The interesting surface is
therefore anything reachable by a stranger with only a share link:

- `POST /api/systems` — the only endpoint that writes caller-supplied bytes
  to storage
- `/s/:id` and `/e/:id` — share pages and embeds, which render stored,
  unauthenticated text
- `/s/:id/preview.png` — caller-supplied image bytes served back
- `/api/oembed` — consumer-supplied dimensions reflected into markup

Anything that makes the editor unusable from a document a stranger supplied
counts too. Two such bugs have already been fixed: unbounded spatial-grid
expansion, and an unbounded preview upload.

## What is not

- Findings that require an attacker to already control the victim's browser
  or machine.
- Reports from automated scanners with no demonstrated impact.
- Missing headers or configuration with no exploitable consequence. Tell us
  anyway if you like, as a normal issue.
- Denial of service by simply sending a great deal of traffic. The Worker
  runs on a metered free tier and we know it.

## What we run

Every deploy is a Cloudflare Worker with a D1 database. There is no
long-lived server and no shell. The full inventory of secrets, what each can
do if leaked, and how to rotate it is in
[secrets](docs/security/reference/secrets.md).

Three separate mechanisms exist to stop a secret reaching the repository, and
they are described there too.
