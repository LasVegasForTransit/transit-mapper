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
  the editor map, the embed, image exports and server previews all call it,
  so none of them can drift from the others.
- `project.ts` is Web Mercator with the map taken out: the same 512px-tile,
  log2-zoom conventions MapLibre uses, plus a `fitBounds` that solves for a
  camera without one. North-up and unpitched only; server output never tilts.
- `svg.ts` composes the finished drawing. It takes a `project` callback rather
  than a map, which is the whole point: the browser passes MapLibre's own
  bound `project()` so an export matches what the user framed on screen, and
  the Worker passes the pure projector.
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

## Preview images

`GET /s/:id/preview.png` builds the SVG and rasterizes it with resvg
(WebAssembly) because every link unfurler refuses SVG for `og:image`. The
share page's `og:image` and `twitter:image` are rewritten to point at it.

Two constraints worth knowing before changing this:

- **Fonts.** resvg has no system fonts inside a Worker, so the bundled subset
  is the entire universe of glyphs a preview can draw — text in a non-latin
  script renders as blank boxes. Only `woff2` works; resvg silently draws
  nothing at all for plain `woff`.
- **Caching.** The image is cached at the edge for a day. A share's contents
  never change, but the *renderer* does, and there's no purge path — so the
  cache key includes `PREVIEW_RENDERER_VERSION`. Bump it when shipping a
  visible change to a renderer that's already live.

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
