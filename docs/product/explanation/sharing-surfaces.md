# Sharing surfaces

A shared system has to look right in places the editor doesn't run: a link
unfurl in Slack, an iframe in someone's article, a thumbnail an oEmbed
consumer fetched. This is how those surfaces work and why they're built the
way they are.

Maintainers use this page when they change a public route, preview, embed,
framing rule, or published View contract.

## One renderer, no map

Drawing a system used to require a live MapLibre instance, because the code
that turns a system into styled features lived in the web app and the code
that drew it called `map.project()`. The Worker has no map and no DOM, so it
could only ever serve one static image for every system.

`packages/core/src/render/` removes that dependency:

- `render-presentation.ts` describes the camera and the CSS size at which its
  result will be seen. Live maps read it from their final camera; pure previews
  derive it from the viewport they fit.
- `buildFeatures.ts` turns a system and that presentation into styled GeoJSON.
  Every surface reaches it, though Network and Diagram take their passenger
  geometry from the renderer's Line scene instead of the per-ServicePlan runs
  this module derives.
- `system-render-scene.ts` validates stable feature IDs, separates invisible
  hit targets from paint geometry, and gives every consumer the same
  deterministic source and tier order.
- `static-visual-scene.ts` resolves geographic widths, offsets, dashes,
  opacity, and tier composition into explicit vector values.
- `project.ts` is Web Mercator with the map taken out: the same 512px-tile,
  log2-zoom conventions MapLibre uses, plus a `fitBounds` that solves for a
  camera without one. North-up and unpitched only; a card never tilts.
- `svg.ts` serializes that resolved scene and composes the finished drawing.
  It takes a `project` callback rather than a map. A framed export samples four
  ground-plane points from MapLibre's live camera and reconstructs that exact
  projective transform in its short-lived SVG Worker, preserving bearing and
  pitch without shipping a second renderer on the editor thread. A share card
  passes the pure north-up projector and needs no map or DOM.
- `preview.ts` is a preset over `svg.ts` for share cards. It picks the framing
  and states how the result will be presented; it does not draw anything
  itself.

The web app's export modules are now thin adapters that supply what only a
live map knows — viewport size, projection, bearing, ground resolution, and
the passenger Lines resolved for that camera. SVG does not recreate a visual
approximation from MapLibre paint expressions; MapLibre and SVG start from the
normalized scene, and SVG consumes already resolved line and polygon paint.

## One stripe per Line

A rider-facing drawing shows Lines, not the operations beneath them. The
editor, reader, embed, PNG, SVG, and share card all paint one stripe per Line
over a shared casing, so a Line served by two ServicePlans comes out once
rather than as two parallel stripes. Clicking one in the reader selects that
Line; its ServicePlans and Patterns are inspector actions reached from there.

Only `@transitmapper/renderer` resolves that geometry, and it depends on core,
so `systemSvg` and `previewSvg` cannot call it without inverting the
dependency. Each Worker entry under `apps/web/src/share` resolves the scene
itself and passes the finished collection in, and core substitutes it for the
per-plan service geometry `buildFeatures` derives. The per-plan travel arrows
leave with that geometry, because an arrow annotates one plan's one-way
stretch while a stripe is the whole corridor.

Resolve the scene against the camera the drawing uses and no other. A Line
scene is clipped and tiered for the bounds it was resolved for, so a second
view derived beside the first hands the drawing a network framed for a camera
it never had. `previewRenderView` exists so a card and its Lines cannot drift
apart that way.

Infrastructure keeps `buildFeatures`, since physical per-Service geometry is
what that view is for. Service termini and junction connectors stay on
`buildFeatures` everywhere: they are route-owned point markers, not corridor
stripes.

## Theme boundary

The editor, read-only share page, onboarding maps, and live embed follow the
viewer's operating-system color scheme. Their neutral chrome, basemap, label
halos, handles, and other editing or reading affordances can change.

The colors a person assigned to lines and other system objects cannot. Those
colors are domain data used by every renderer, not theme accents. Live maps
put a scheme-appropriate neutral casing beneath user-colored routes so
near-black, near-white, and saturated colors keep enough local contrast
without changing the stored value.

Portable artifacts are deliberately different. PNG and SVG exports, uploaded
share cards, and Worker-served/generated preview surfaces always use the light
palette. The same snapshot therefore produces the same artifact regardless
of the operating-system theme of the browser that requested it.

## Detail follows display size

An exported image is looked at close to full size. A link unfurl is composed
at card size and then rendered by a chat client into a column a third as wide.
Type sized for the first is illegible mush in the second.

Geographic detail uses the complete `RenderPresentation`: fitted bounds and
zoom, authored viewport size, displayed size, and pixel ratio. A corridor's
width is projected into displayed CSS pixels. Below 2 px it is one Overview
silhouette; Overview and District blend from 2–4 px; District and Street blend
from 9–12 px. Static output applies those weights deterministically, without
the camera-history hysteresis a live map uses. Device pixel ratio sharpens a
raster but cannot make the drawing choose more detail.

Map furniture has a related, smaller contract. `systemSvg` takes the width at
which the drawing will actually be _seen_, and optional labels, title, legend,
scale bar, and north arrow derive from it. Anything that would land under
about ten displayed pixels is not drawn, because unreadable text is worse than
absent text. That rule is why a share card carries less furniture while a
full-size export keeps it.

A second presentation fact, `captionedExternally`, says whether the surface
showing the image already prints the system's name beside it. Chat clients do,
so the card omits its own title and legend instead of saying it twice in worse
type. A downloaded file has nothing captioning it and keeps them.

Neither presentation contract names individual elements to remove. Adding a
separate geographic renderer or a "card mode" drawing branch would let live
and portable output drift apart.

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
_pixels_ trustworthy, and that's the thing we can't afford. What the design
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

Share creation is rate limited to 20 per minute per client IP, via the
`[[ratelimits]]` binding in `wrangler.toml`. It's the only endpoint that
writes caller-supplied bytes to storage, and the size cap bounds a single
upload without bounding how many arrive. A binding rather than a dashboard
rule so it lives with the code it protects, shows up in review, and survives
someone rebuilding the zone.

The limiter is skipped when there's no `cf-connecting-ip` header, which means
local development. If that header _is_ present and the binding is missing —
the deployed config lost it — the endpoint returns 503 rather than quietly
accepting unlimited writes.

## Systems and Views

A shared system and a published View are different resources. A system share
stores one immutable transit document. A View stores a title and portable map
state that references that shared system. Publishing a View creates the system
share first, then stores the View reference. Renaming or deleting a local View
does not mutate the transit document.

The public routes keep content and presentation separate:

| Route        | Resource       | Presentation state                       |
| ------------ | -------------- | ---------------------------------------- |
| `/s/:id`     | Shared system  | Synthetic default View plus URL fragment |
| `/v/:id`     | Published View | Stored View plus optional URL fragment   |
| `/e/:id`     | Shared system  | The same synthetic View as `/s/:id`      |
| `/embed/:id` | Published View | The same stored View as `/v/:id`         |

The full reader mounts `MapWorkspace` with reader chrome. The editor mounts the
same workspace with mutation commands and editor chrome. Neither reader route
constructs an editor store. A broad network map is therefore one saved View,
not a separate application mode.

Version 1 reuses the referenced system share's preview image for published
View metadata. It does not rasterize one card per View.

## Embeds

`/e/:id` and `/embed/:id` use a separate Vite entry, not the editor with its
chrome hidden. An embed competes with the host page's load budget, so it pulls
in MapLibre and the shared projection Worker and nothing else. It imports no
React, editor store, or toolbars. Both embed routes use the renderer's document
map definition and the same hostile-input View parser as the full reader.

That Worker outlives the first paint. A Line scene covers only the camera it
was resolved for, and a reader can pan an embed straight off it, so the embed
projects again on `moveend` and `resize` and keeps whichever scene was
requested last rather than whichever returns last.

It is the only path on the origin any site may frame; everything else is
served with `frame-ancestors 'none'`. The embed exposes nothing a share link
doesn't already show to anyone holding it, and carries no account state, so
there's no clickjacking surface behind that exception.

`/api/oembed` describes shared-system and published-View links for publishers
that speak oEmbed, so pasting either full reader link into WordPress or Ghost
produces the matching iframe. It only answers for URLs on our own origin.
Otherwise it would describe, and lend the provider name to, arbitrary pages.

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
deliberately _not_ the same palette as the editor UI, which remains a cooler
ink-on-white system with its own typeface.
