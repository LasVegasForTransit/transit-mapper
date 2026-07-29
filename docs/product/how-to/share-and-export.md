# Share and export

## Share a read-only link

**Share…** (top bar) uploads a snapshot of the current system and gives you a
URL. Anyone with the link sees a read-only copy: they can pan, zoom, and
switch views, and can **fork** it into their own editable copy. The snapshot
is frozen at the moment you shared; later edits need a new link.

Sharing requires the backend (a Cloudflare Worker with a D1 database). In
local development without a worker running, sharing is unavailable; the rest
of the editor works fine.

An anonymous share link lasts seven days, and every view pushes that back
another seven. A link people are still opening stays alive; one nobody opens
expires. Permanent shares are waiting on accounts.

## Paste a link somewhere

Paste a share link into Slack, Discord, iMessage, or anywhere else that
unfurls links, and you get a real picture of the system — its lines and
stations — not a generic site-wide card. The card is drawn once, when you
create the link, and served afterwards as a plain image, so it works for
crawlers that never run JavaScript.

The picture is the network on its own. The system's name and size come from
the link preview's own text, which every client shows beside the image, so
the card doesn't repeat them.

You can also fetch it directly at `/s/<id>/preview.png` if you want the image
for a slide or a document.

## Embed a map in a page

Any share link can be embedded as a live, read-only map:

```html
<iframe
  src="https://map.lasvegasfortransit.org/e/<id>"
  width="800"
  height="500"
  style="border:0"
></iframe>
```

Readers can pan and zoom, and click through to the full system. The embed is
its own lightweight page — it loads the map, not the editor.

Publishing platforms that support [oEmbed](https://oembed.com) (WordPress,
Ghost, Discourse, and others) can build that iframe themselves: paste the
plain share link and they'll discover the embed automatically.

## Export an image

The **Export** button exports the current view straight to **PNG**; the
dropdown next to it also offers **SVG**, and **Export…** opens a dialog with
a live preview where you can choose what's included. `C` captures a quick
PNG of the whole system from the keyboard.

Exports are rendered from the system data itself, not screenshotted from the
map, so they come out clean at any size and include a legend. PNG and SVG
exports always use the light basemap and light paper palette, even when the
editor is following a dark operating-system theme. That makes a downloaded
artifact deterministic and portable into documents and presentations.

## Save data

Systems save automatically in your browser (local storage); the Systems
dialog manages multiple systems. A JSON export of the full system document is
available for backup or moving between browsers. It round-trips through the
same versioned serializer the app uses, so old files keep loading as the
schema evolves.

## Hide the interface

`\` toggles all floating panels away, leaving just the map, which is useful
for screen-sharing or screenshots beyond the built-in export.
