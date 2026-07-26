# Sharing surfaces

A shared system has to look right in places the editor doesn't run: a link
unfurl in Slack, an iframe in someone's article, a thumbnail an oEmbed
consumer fetched. This is how those surfaces work and why they're built the
way they are.

## One renderer, no map

Drawing a system used to require a live MapLibre instance, because the code
that turns a system into styled features lived in the web app and the code
that drew it called `map.project()`. The Worker has no map and no DOM, so it
could only ever serve one static image for every system.

`packages/core/src/render/` removes that dependency:

- `buildFeatures.ts` turns a system into styled GeoJSON. Pure, and shared —
  the editor map, the embed, image exports and the share card all call it,
  so none of them can drift from the others.
- `project.ts` is Web Mercator with the map taken out: the same 512px-tile,
  log2-zoom conventions MapLibre uses, plus a `fitBounds` that solves for a
  camera without one. North-up and unpitched only; a card never tilts.
- `svg.ts` composes the finished drawing. It takes a `project` callback rather
  than a map, which is the whole point: an export passes MapLibre's own bound
  `project()` so it matches what the user framed on screen, while a share card
  passes the pure projector and needs no map at all.
- `preview.ts` is a preset over `svg.ts` for share cards. It picks the framing
  and states how the result will be presented; it does not draw anything
  itself.

The web app's export modules are now thin adapters that supply what only a
live map knows — viewport size, projection, bearing, ground resolution.

## Detail follows display size

An exported image is looked at close to full size. A link unfurl is composed
at card size and then rendered by a chat client into a column a third as wide.
Type sized for the first is illegible mush in the second.

Rather than a flag per element, `systemSvg` takes one number — how wide the
drawing will actually be *seen* — and every optional element derives from it.
Anything that would land under about ten displayed pixels isn't drawn, on the
grounds that unreadable text is worse than absent text. That single rule is
why a share card carries no station labels, scale bar or north arrow while a
full-size export keeps all of them, and it's the same idea as the
Infrastructure view deriving lane detail from zoom.

A second presentation fact, `captionedExternally`, says whether the surface
showing the image already prints the system's name beside it. Chat clients do,
so the card omits its own title and legend instead of saying it twice in worse
type. A downloaded file has nothing captioning it and keeps them.

Neither input names an element to remove. Adding a "card mode" branch would
be the thing to avoid here.

## Preview images, and why the browser draws them

`GET /s/:id/preview.png` serves a stored PNG. It doesn't draw one.

The Worker used to rasterize on demand with resvg, and it can't: a free-plan
Worker gets **10 ms of CPU per request**, and drawing a card measured around
65 ms — roughly 7x over. Shrinking doesn't rescue it either; even a 400px card
costs ~16 ms, and building the SVG alone is ~10 ms. Server-side rasterization
is not a free-tier feature at any useful size.

So the sharer's browser draws the card instead, at share time, and uploads it
alongside the system. A browser has no such CPU budget, is already holding the
system, and only does this once per share. The Worker's job shrinks to handing
bytes back, which is close to free. Removing resvg also took ~2.4 MB of wasm
and a bundled font subset out of the Worker.

Consequences worth knowing:

- **A share may have no card.** A client that can't rasterize, or an API
  caller with no browser, simply omits it. The route falls back to the
  site-wide image rather than 404ing, so `og:image` is never a broken link.
- **The card is a snapshot, like the system.** It's fixed at creation and
  never regenerated, so a later change to the renderer doesn't alter existing
  shares.

## Treating the uploaded card as hostile

Accepting an image from a client means accepting bytes we didn't produce. The
honest framing: nothing short of re-rendering server-side can make the
*pixels* trustworthy, and that's the thing we can't afford. What the design
can do is stop the endpoint becoming general-purpose file hosting, and make
whatever is stored inert.

On the way in (`packages/core/src/render/pngBytes.ts`):

- Bounded **before** decoding — the base64 length is checked first, so an
  oversized payload is rejected without being allocated.
- Must be a PNG: signature, then IHDR as the first chunk.
- Must be exactly card-sized. An arbitrary image of another size is refused.
- The chunk chain must be **clean** — IHDR first, IEND last, and not one byte
  after it. This is what rejects polyglots: a file can carry a valid PNG
  header and append markup or an archive, and any check that only reads the
  header waves it through.

Anything failing is dropped and the share is created without a card, rather
than failing the share. Retrying wouldn't help, and a share is more valuable
than its picture.

On the way out, the response is pinned to being an inert image:
`Content-Type: image/png` with `X-Content-Type-Options: nosniff` (so a browser
can't sniff its way to treating the body as HTML, which would be stored XSS on
our own origin), a `default-src 'none'; sandbox` CSP, and `X-Robots-Tag:
noindex` (which removes most of the point of using this as free image
hosting).

The preview is accepted **only at share creation**. There is deliberately no
route that updates an existing share's card — that would let anyone holding a
share id replace someone else's.

**Residual risk, stated plainly:** someone can store a genuine, correctly
sized PNG of their choosing at a URL on this domain, tied to a share they
created, which expires like any other. Bounding that further is a rate-limit
problem, not a validation one — see below.

## Staying inside the free tier

Everything here is sized to run on Cloudflare's free plans, which is why the
architecture looks the way it does. The two limits that actually bind:

- **10 ms CPU per request** — the reason cards are drawn client-side.
- **100,000 Worker requests/day** — and requests past it get a 429 rather
  than falling back to serving the asset.

That second one is why the Worker deliberately does not run first (see
`wrangler.toml`). Static assets served without invoking it are free and
unlimited; with `run_worker_first = true`, every JS chunk, stylesheet and
favicon on every page load was a billed invocation. Only `/api/*`, share pages
and embeds reach the Worker now — a homepage visit costs zero invocations.

Everything else has ample headroom: D1 at 500 MB (a stored card is ~25 KB and
capped at 120 KB), one or two Cache API calls against a limit of 50, a single
subrequest against 50, and cron triggers included.

**Before opening this up to real traffic**, add a Cloudflare rate-limiting
rule on `POST /api/systems`. The free plan includes one such rule, and share
creation is the only endpoint that writes attacker-controlled bytes to
storage — the size cap bounds a single upload, but nothing in the Worker
bounds how many a script can send.

## Embeds

`/e/:id` is a separate Vite entry, not the editor with its chrome hidden. An
embed competes with the host page's load budget, so it pulls in MapLibre and
the feature builder and nothing else — no React, no editor store, no toolbars.

It is the only path on the origin any site may frame; everything else is
served with `frame-ancestors 'none'`. The embed exposes nothing a share link
doesn't already show to anyone holding it, and carries no account state, so
there's no clickjacking surface behind that exception.

`/api/oembed` describes a share for publishers that speak oEmbed, so pasting a
plain share link into WordPress or Ghost produces the iframe automatically. It
only answers for URLs on our own origin — otherwise it would describe (and
lend the provider name to) anything at all.

## Share lifetime

Anonymous shares expire, but an embedded map that 404s a week after
publication is worse than no embed. So a successful view slides the expiry
forward another week, skipping the write unless the stored value has drifted
far enough to be worth one.

This is a stopgap, not the design. Ownership is the real answer — a signed-in
person's shares never expire — which is why the schema has always treated a
null expiry as "never expires" and why the slide deliberately skips those rows.

## Brand

Anything leaving the app carries the org's name, so these surfaces use the
Las Vegans for Better Transit brand rather than the editor's own chrome:
Public Sans, the brand's paper and raised-surface tones, ink rules. The values
are transcribed once in `packages/core/src/style/lvbtBrand.ts` from the brand
page and read from there; nothing downstream restates a hex code. Note this is
deliberately *not* the same palette as the editor UI, which remains a cooler
ink-on-white system with its own typeface.
