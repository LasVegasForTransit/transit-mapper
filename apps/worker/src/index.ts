import { Hono, type Context } from 'hono';
import { parseSystem } from '@transitmapper/core/model/serialize';
import { shortId } from '@transitmapper/core/model/ids';
import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  MAX_SHARE_BODY_BYTES,
  type CreateShareResponse,
  type GetShareResponse,
} from '@transitmapper/core/share/contract';
import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from '@transitmapper/core/render/preview';
import { checkPreviewPng, MAX_PREVIEW_BYTES } from '@transitmapper/core/render/pngBytes';
import { handleOpenStreetMapWays, handlePlaceSearch } from './osm-gateway';
import type { PlaceSearchGate } from './place-search-gate';

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_URL: string;
  /** Provider endpoint is configuration so production can move away from the
   * public Nominatim service without rebuilding the application. */
  NOMINATIM_URL: string;
  /** Ceiling on share creation — see the `[[ratelimits]]` block in
   *  wrangler.toml for why this endpoint in particular has one. Optional
   *  because `wrangler dev` doesn't provide it locally. */
  SHARE_CREATE_LIMITER?: RateLimiter;
  /** Protect the public geocoding and Overpass commons independently. */
  PLACE_SEARCH_LIMITER?: RateLimiter;
  PLACE_UPSTREAM_LIMITER?: RateLimiter;
  OSM_TILE_LIMITER?: RateLimiter;
  /** Global public-Nominatim reservation coordinator. */
  PLACE_SEARCH_GATE?: DurableObjectNamespace<PlaceSearchGate>;
}

const ANONYMOUS_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days.

// The iframe size we ask for when a consumer doesn't constrain us — wide
// enough for a regional system to read, short enough to sit inside an article
// without taking over the page.
const EMBED_DEFAULT_WIDTH = 800;
const EMBED_DEFAULT_HEIGHT = 500;

/** Share ids are lowercase alphanumerics from shortId; anything else in an
 *  id-shaped position is someone probing, not a real link. */
export const SHARE_ID_PATTERN = /^[0-9a-z]{1,32}$/;

/**
 * Pulls the share id out of a share or embed URL, but only for our own
 * origin. Scoping to SITE_URL is what stops this from being an open oEmbed
 * endpoint that will describe (and lend our provider name to) arbitrary URLs.
 */
export function shareIdFromUrl(target: string, siteUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (url.origin !== new URL(siteUrl).origin) return null;

  const match = /^\/(?:s|e)\/([^/]+)\/?$/.exec(url.pathname);
  const id = match?.[1];
  return id && SHARE_ID_PATTERN.test(id) ? id : null;
}

export function positiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** For interpolating user-supplied text into the oEmbed `html` payload. That
 *  string is raw markup by definition — HTMLRewriter can't escape it for us
 *  the way it does for the share page's meta tags. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Decodes and vets an uploaded preview card. Returns the bytes to store, or
 * null to store nothing — a share without a card is fine, so anything
 * suspicious is dropped rather than failing the whole share.
 *
 * These bytes came from a browser we don't control, so they get treated as
 * hostile input: bounded before decoding, then required to actually be a PNG
 * of exactly card size. That can't make the *pixels* trustworthy (only
 * re-rendering server-side could, which is the thing we can't afford), so the
 * route that serves them back is hardened too — see the preview route below.
 */
export function acceptedPreview(raw: unknown): Uint8Array | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  // Base64 inflates by 4/3; bound the string before allocating anything so a
  // huge payload is rejected without being decoded.
  if (raw.length > Math.ceil((MAX_PREVIEW_BYTES * 4) / 3) + 4) return null;

  let bytes: Uint8Array;
  try {
    const binary = atob(raw);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } catch {
    return null;
  }

  const check = checkPreviewPng(bytes, { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
  return check.ok ? bytes : null;
}

// Security headers for HTML the Worker renders itself. Assets served straight
// from Cloudflare get the equivalent from apps/web/public/_headers, which does
// not apply to Worker responses.
//
// `noindex` is what keeps shared systems out of search results. It is
// deliberately not `Disallow` in robots.txt: unfurlers honour robots and would
// then refuse to fetch the page at all, leaving every pasted link with a blank
// card. Fetchable but unindexed is exactly the combination wanted here.
const HTML_SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-robots-tag': 'noindex',
};

function withHtmlSecurityHeaders(response: Response, frameAncestors: string): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(HTML_SECURITY_HEADERS)) out.headers.set(name, value);
  out.headers.set('content-security-policy', `frame-ancestors ${frameAncestors}`);
  return out;
}

const app = new Hono<{ Bindings: Env }>();

// Unhandled failures must not leak internals, and an /api client should get
// JSON rather than a wall of text it can't parse.
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.req.path.startsWith('/api/')
    ? c.json({ error: 'Internal error' }, 500)
    : c.text('Something went wrong.', 500);
});

interface ShareRow {
  id: string;
  system: TransitSystem;
  createdAt: number;
  /** Epoch ms, or null for a share that never expires. */
  expiresAt: number | null;
}

// Look up a share by id, treating an expired-but-not-yet-swept row as if it
// doesn't exist (and deleting it on the spot) — shared by the JSON API and
// the /s/:id HTML route so the expiry rule only lives in one place.
//
// A live share also has its clock pushed forward on the way out (see
// touchExpiry): a share people are still looking at is a share still worth
// keeping. That matters now that a share can be embedded in someone else's
// blog post, where a fixed 7-days-from-creation expiry would turn the embed
// into a 404 a week after publication.
async function getActiveShare(db: D1Database, id: string): Promise<ShareRow | null> {
  // Ids that can't have come from shortId() are someone probing. Rejecting
  // them here rather than querying keeps junk out of the Worker's response
  // cache on /s/:id/preview.png, where every distinct id would otherwise earn
  // its own entry.
  if (!SHARE_ID_PATTERN.test(id)) return null;

  const row = await db
    .prepare('SELECT id, data, created_at, expires_at FROM systems WHERE id = ?')
    .bind(id)
    .first<{ id: string; data: string; created_at: number; expires_at: number | null }>();

  if (!row) return null;

  if (row.expires_at !== null && row.expires_at < Date.now()) {
    await db.prepare('DELETE FROM systems WHERE id = ?').bind(id).run();
    return null;
  }

  // A row whose JSON won't parse is treated as a share that isn't there.
  // Letting the throw escape turns one damaged row into a 500 on the share
  // page, the API read AND the oEmbed endpoint — a 404 is both truthful (we
  // cannot produce this system) and survivable for everything around it.
  let system: TransitSystem;
  try {
    system = parseSystem(JSON.parse(row.data));
  } catch {
    console.error(`Share ${id} has unparseable data`);
    return null;
  }

  return {
    id: row.id,
    system,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

// How far the stored expiry must have drifted from "a full TTL from now"
// before a view is worth a write. Without this every read of a popular share
// becomes a D1 write; with it, a share is touched at most once a day no
// matter how often it's viewed, and still never gets within six days of
// expiring while anyone is looking at it.
const EXPIRY_TOUCH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 day.

/**
 * Slides a share's expiry forward on view. Fire-and-forget: the caller's
 * response must not wait on it, and a share that fails to be touched simply
 * expires on its original schedule.
 *
 * This is an interim answer to "shares people still use shouldn't vanish."
 * The real answer is ownership — a signed-in user's shares get expires_at =
 * NULL and never expire — which is why the schema already treats NULL as
 * "never expires" and why this deliberately skips those rows.
 */
function touchExpiry(
  db: D1Database,
  share: Pick<ShareRow, 'id' | 'expiresAt'>,
): Promise<unknown> | null {
  if (share.expiresAt === null) return null; // account-owned: already permanent.
  const target = Date.now() + ANONYMOUS_SHARE_TTL_MS;
  if (target - share.expiresAt < EXPIRY_TOUCH_THRESHOLD_MS) return null;
  return db
    .prepare('UPDATE systems SET expires_at = ? WHERE id = ?')
    .bind(target, share.id)
    .run()
    .catch(() => undefined);
}

// Used both for the dedup content hash (so two requests only collide when
// they'd have written byte-identical rows) and for edit tokens (so the DB
// never holds the raw secret a browser presents to prove it owns a share).
async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// The secret returned once, at creation, to the browser that made a share.
// Presenting it on PATCH/DELETE is what proves "the device that created this
// share" without any account system — see edit_token_hash in the schema.
function randomEditToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Deletes the cached preview.png entry for a share so a stale card doesn't
// keep being served for up to a day after the content underneath it changes.
// Cache keys are full requests, so this has to reconstruct the same URL the
// preview route itself is fetched at.
function purgePreviewCache(c: Context<{ Bindings: Env }>, id: string): Promise<unknown> {
  return caches.default
    .delete(new Request(`${c.env.SITE_URL}/s/${id}/preview.png`))
    .catch(() => undefined);
}

// Create an immutable snapshot of a system and return its share id.
app.post('/api/systems', async (c) => {
  // Keyed on the client IP Cloudflare attaches to the request, which a caller
  // can't set themselves.
  //
  // The header is absent in local dev, and so is the binding, so the limiter
  // is skipped there — but the two are checked separately on purpose. Missing
  // header means "not behind Cloudflare", i.e. local. A *present* header with
  // no binding means the deployed config lost its binding (easy to do: the
  // wrangler 4 syntax for this is silently ignored by wrangler 3), and that
  // must be loud rather than a silent loss of rate limiting in production.
  const clientIp = c.req.header('cf-connecting-ip');
  if (clientIp) {
    if (!c.env.SHARE_CREATE_LIMITER) {
      console.error('SHARE_CREATE_LIMITER binding missing — refusing to accept shares unlimited');
      return c.json({ error: 'Share creation is temporarily unavailable' }, 503);
    }
    const { success } = await c.env.SHARE_CREATE_LIMITER.limit({ key: clientIp });
    if (!success) {
      return c.json({ error: 'Too many shares created. Try again in a minute.' }, 429);
    }
  }

  // Checked before reading the body, not after. `await c.req.text()` buffers
  // the whole request into memory, so a check that runs afterwards has already
  // paid the cost it was meant to avoid — the caller controls the size and we
  // would allocate all of it first.
  //
  // The header is a claim by the caller, so the buffered length is still
  // checked below; this just refuses the obvious cases without reading them.
  // That second check counts bytes rather than `raw.length`, which is UTF-16
  // code units — a body of multi-byte characters measures up to three times
  // smaller that way and slipped past the limit entirely.
  const declaredLength = Number(c.req.header('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SHARE_BODY_BYTES) {
    return c.json({ error: 'System too large' }, 413);
  }

  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_SHARE_BODY_BYTES) {
    return c.json({ error: 'System too large' }, 413);
  }

  let system;
  let preview: Uint8Array | null;
  try {
    const body = JSON.parse(raw) as { system?: unknown; preview?: unknown };
    system = parseSystem(body.system);
    preview = acceptedPreview(body.preview);
  } catch (e) {
    return c.json({ error: `Invalid system: ${(e as Error).message}` }, 400);
  }

  const now = Date.now();
  const data = JSON.stringify(system);
  const hash = await sha256Hex(data);

  // Reuse an existing share for byte-identical content rather than minting a
  // new row and a new URL every time the dialog is opened on an unchanged
  // system. A hit that's already expired is swept here, same as a normal read
  // would, rather than reused.
  //
  // Deliberately does NOT return an editToken for a reused row: this caller
  // never proved ownership of it (that's the whole point of the token), so
  // handing one out here would let anyone who can reproduce a share's exact
  // content take over editing it.
  const existing = await c.env.DB.prepare(
    'SELECT id, expires_at FROM systems WHERE content_hash = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(hash)
    .first<{ id: string; expires_at: number | null }>();

  if (existing) {
    if (existing.expires_at === null || existing.expires_at >= now) {
      const touch = touchExpiry(c.env.DB, { id: existing.id, expiresAt: existing.expires_at });
      if (touch) c.executionCtx.waitUntil(touch);
      return c.json<CreateShareResponse>({ id: existing.id });
    }
    await c.env.DB.prepare('DELETE FROM systems WHERE id = ?').bind(existing.id).run();
  }

  const id = shortId(10);
  const expiresAt = now + ANONYMOUS_SHARE_TTL_MS;
  const editToken = randomEditToken();
  const editTokenHash = await sha256Hex(editToken);
  await c.env.DB.prepare(
    'INSERT INTO systems (id, name, data, created_at, expires_at, preview, content_hash, edit_token_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, system.name.slice(0, 200), data, now, expiresAt, preview, hash, editTokenHash)
    .run();

  return c.json<CreateShareResponse>({ id, editToken });
});

// Fetch a shared system snapshot. This is the request an embedded map makes,
// so it's the one that keeps a share alive while it's still being read.
app.get('/api/systems/:id', async (c) => {
  const share = await getActiveShare(c.env.DB, c.req.param('id'));
  if (!share) return c.json({ error: 'Not found' }, 404);

  const touch = touchExpiry(c.env.DB, share);
  if (touch) c.executionCtx.waitUntil(touch);

  // Built field by field rather than returning the row: expiresAt is internal
  // bookkeeping, not part of the published wire format.
  return c.json<GetShareResponse>({
    id: share.id,
    system: share.system,
    createdAt: share.createdAt,
  });
});

// Updates a share's content in place, so re-sharing an edited system keeps
// the same URL instead of accumulating a new one every time. Gated on the
// edit token handed out at creation — the WHERE clause does the auth check
// and the write in one statement, so there's no separate check-then-write
// race to get wrong.
app.patch('/api/systems/:id', async (c) => {
  const id = c.req.param('id');
  if (!SHARE_ID_PATTERN.test(id)) return c.json({ error: 'Not found' }, 404);

  const editToken = c.req.header('x-edit-token');
  if (!editToken) return c.json({ error: 'Missing edit token' }, 403);

  // Same limiter as create: this writes caller-supplied bytes too.
  const clientIp = c.req.header('cf-connecting-ip');
  if (clientIp) {
    if (!c.env.SHARE_CREATE_LIMITER) {
      console.error('SHARE_CREATE_LIMITER binding missing — refusing to accept edits unlimited');
      return c.json({ error: 'Share editing is temporarily unavailable' }, 503);
    }
    const { success } = await c.env.SHARE_CREATE_LIMITER.limit({ key: clientIp });
    if (!success) return c.json({ error: 'Too many edits. Try again in a minute.' }, 429);
  }

  const declaredLength = Number(c.req.header('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SHARE_BODY_BYTES) {
    return c.json({ error: 'System too large' }, 413);
  }
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_SHARE_BODY_BYTES) {
    return c.json({ error: 'System too large' }, 413);
  }

  let system;
  let preview: Uint8Array | null;
  try {
    const body = JSON.parse(raw) as { system?: unknown; preview?: unknown };
    system = parseSystem(body.system);
    preview = acceptedPreview(body.preview);
  } catch (e) {
    return c.json({ error: `Invalid system: ${(e as Error).message}` }, 400);
  }

  const data = JSON.stringify(system);
  const hash = await sha256Hex(data);
  const tokenHash = await sha256Hex(editToken);
  // An edit is a deliberate write, not a passive view, so it always slides
  // expiry forward a full TTL rather than going through touchExpiry's
  // once-a-day threshold (that threshold exists to stop *reads* from turning
  // into writes; this is already a write).
  const expiresAt = Date.now() + ANONYMOUS_SHARE_TTL_MS;

  const result = await c.env.DB.prepare(
    `UPDATE systems
     SET name = ?, data = ?, content_hash = ?, preview = ?,
         expires_at = CASE WHEN expires_at IS NULL THEN NULL ELSE ? END
     WHERE id = ? AND edit_token_hash = ?`,
  )
    .bind(system.name.slice(0, 200), data, hash, preview, expiresAt, id, tokenHash)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'Not authorized to edit this share' }, 403);
  }

  c.executionCtx.waitUntil(purgePreviewCache(c, id));
  return c.json<CreateShareResponse>({ id });
});

// Revokes a share early rather than waiting for its TTL. Same auth shape as
// PATCH: the token proves the caller's browser created this share.
app.delete('/api/systems/:id', async (c) => {
  const id = c.req.param('id');
  if (!SHARE_ID_PATTERN.test(id)) return c.json({ error: 'Not found' }, 404);

  const editToken = c.req.header('x-edit-token');
  if (!editToken) return c.json({ error: 'Missing edit token' }, 403);

  const tokenHash = await sha256Hex(editToken);
  const result = await c.env.DB.prepare('DELETE FROM systems WHERE id = ? AND edit_token_hash = ?')
    .bind(id, tokenHash)
    .run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'Not authorized to revoke this share' }, 403);
  }

  c.executionCtx.waitUntil(purgePreviewCache(c, id));
  return c.body(null, 204);
});

// Proxy RTC Southern Nevada's real GTFS feed — its own host doesn't send
// CORS headers, so the browser can't fetch it directly; this endpoint (same
// origin as the app) sidesteps that.
//
// Cached at the edge for a day. The feed is ~15 MB and an agency publishes a
// new one every few weeks, so re-fetching per request was pure waste — and
// worse, it was an amplifier: one request here meant 15 MB pulled from RTC's
// servers, with nothing stopping a script from doing that in a loop. Now the
// first request of the day pays for it and the rest are served from cache.
const GTFS_FEED_URL = 'https://developer.rtcsnv.com/transitData/google_transit.zip';
const GTFS_CACHE_SECONDS = 86400;

app.get('/api/gtfs/rtc', async (c) => {
  const cache = caches.default;
  const cached = await cache.match(c.req.raw);
  if (cached) return cached;

  const upstream = await fetch(GTFS_FEED_URL, {
    headers: {
      // A Worker's fetch sends no User-Agent at all. Identifying ourselves is
      // the courteous thing regardless — an agency reading its own logs can
      // see who pulls the feed and how to reach us — but it did not stop
      // RTC's WAF refusing us, so it is not the remedy it was hoped to be.
      // No version: the package version is managed by release tooling and is
      // not bundled here, so a literal would be a number nobody maintains.
      'user-agent': `TransitMapper (+${c.env.SITE_URL})`,
      accept: 'application/zip, application/octet-stream;q=0.9, */*;q=0.8',
    },
    // No `cf` cache override. There used to be one — `cacheEverything` with a
    // day-long `cacheTtl` — as belt and braces behind the response cache
    // above. It is what turned a refusal into an outage: `cacheTtl` applies to
    // every status, so one 403 from the agency's WAF was pinned at the edge
    // for a day and re-served to everyone, and each retry refreshed it. A
    // failure that outlives its own cause is bad on its own; worse, nothing
    // can tell whether a fix worked while a stale refusal is being replayed,
    // and that layer cannot be purged from here because the zone is not ours.
    //
    // `caches.default` above already stops the amplification this was added
    // for, and it only ever stores a success, because this handler returns
    // before `cache.put` on anything else. One cache we control beats two
    // where the second can hold a failure we cannot clear.
  });
  if (!upstream.ok || !upstream.body) {
    // Carry the agency's own trace id. A 403 here is theirs to explain, and
    // the first thing they will ask for is the ray that produced it — without
    // it the report is "your server said no sometimes", which goes nowhere.
    const ray = upstream.headers.get('cf-ray');
    return c.json(
      {
        error: `RTC GTFS feed unavailable (${upstream.status})`,
        ...(ray ? { upstreamRay: ray } : {}),
      },
      502,
    );
  }

  const response = new Response(upstream.body, {
    headers: {
      'content-type': 'application/zip',
      'cache-control': `public, max-age=${GTFS_CACHE_SECONDS}`,
    },
  });
  c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));
  return response;
});

// Browser clients use same-origin gateways for public OpenStreetMap services.
// The gateway module owns validation, success-only edge caching, upstream
// identity, failover and response ceilings; keeping those constraints here
// prevents every browser session from becoming an uncoordinated public-API
// client.
app.get('/api/places', (c) => handlePlaceSearch(c.req.raw, c.env, c.executionCtx));
app.get('/api/openstreetmap/ways', (c) =>
  handleOpenStreetMapWays(c.req.raw, c.env, c.executionCtx),
);

// oEmbed discovery/consumption: a publisher (WordPress, Ghost, Discourse,
// Notion) that finds the <link rel="alternate"> on a share page fetches this
// to learn how to embed it, and pastes back the iframe we hand them.
// Deliberately unauthenticated and cacheable — it exposes nothing the share
// page doesn't already.
app.get('/api/oembed', async (c) => {
  const target = c.req.query('url');
  const format = c.req.query('format') ?? 'json';
  // The spec allows an xml format; we only speak json, and 501 is what it
  // says to return for a format we can't produce.
  if (format !== 'json') return c.json({ error: 'Only json format is supported' }, 501);
  if (!target) return c.json({ error: 'Missing url parameter' }, 400);

  const id = shareIdFromUrl(target, c.env.SITE_URL);
  if (!id) return c.json({ error: 'Not an embeddable TransitMapper URL' }, 404);

  const share = await getActiveShare(c.env.DB, id);
  if (!share) return c.json({ error: 'Not found' }, 404);

  // maxwidth/maxheight are the consumer telling us how much room it has; we
  // ask for our preferred size and shrink to fit whatever they allow.
  const maxWidth = positiveInt(c.req.query('maxwidth'));
  const maxHeight = positiveInt(c.req.query('maxheight'));
  const width = Math.min(EMBED_DEFAULT_WIDTH, maxWidth ?? EMBED_DEFAULT_WIDTH);
  const height = Math.min(EMBED_DEFAULT_HEIGHT, maxHeight ?? EMBED_DEFAULT_HEIGHT);

  const embedUrl = `${c.env.SITE_URL}/e/${id}`;
  return c.json(
    {
      version: '1.0',
      type: 'rich',
      provider_name: 'TransitMapper',
      provider_url: c.env.SITE_URL,
      title: share.system.name || 'Transit system',
      width,
      height,
      thumbnail_url: `${c.env.SITE_URL}/s/${id}/preview.png`,
      thumbnail_width: PREVIEW_WIDTH,
      thumbnail_height: PREVIEW_HEIGHT,
      // Attribute values are quoted and the id is [A-Za-z0-9] by construction
      // (shortId), so there's nothing here that could break out of the markup.
      html: `<iframe src="${embedUrl}" width="${width}" height="${height}" style="border:0" loading="lazy" allowfullscreen title="${escapeHtmlAttribute(share.system.name || 'Transit system')}"></iframe>`,
    },
    200,
    { 'cache-control': 'public, max-age=3600' },
  );
});

app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

// Headers for serving a stored preview. The bytes passed validation at upload
// (PNG signature, IHDR, exact card dimensions) but that only proves the file
// starts as a PNG — a polyglot can carry markup after a valid header, and the
// pixels themselves are whatever the uploader chose. So the response is
// pinned to being an inert image and nothing else:
//
// - `nosniff` stops a browser content-sniffing its way to treating the body
//   as HTML, which would be stored XSS on our own origin.
// - The CSP denies everything and sandboxes the response, so even if it were
//   somehow navigated to as a document it can't run script or load anything.
// - `noindex` keeps these out of image search, which removes most of the
//   point of using this endpoint as free image hosting.
const PREVIEW_RESPONSE_HEADERS: Record<string, string> = {
  'content-type': 'image/png',
  'content-disposition': 'inline',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox",
  'x-robots-tag': 'noindex',
  // A share's image is fixed at creation and never updated, so it can be
  // cached hard. Not `immutable`/a year, though: a share is *deleted* when it
  // expires, and a day is short enough that a deleted system stops being
  // served promptly while still absorbing the burst of crawler hits that
  // follows someone pasting a link.
  'cache-control': 'public, max-age=86400',
};

// Per-system preview image: what an unfurled link actually shows, as a plain
// GET, so crawlers that don't run JavaScript (all of them) still see the real
// system. The card was drawn by the sharer's browser at creation time — a
// free-plan Worker has 10ms of CPU per request and rasterizing one costs
// closer to 65ms, so this route only hands back stored bytes.
app.get('/s/:id/preview.png', async (c) => {
  const id = c.req.param('id');
  // This route builds its own query rather than going through
  // getActiveShare, so it needs the same id check — without it every probe
  // for a nonexistent share takes a database round trip and, worse, earns a
  // cache entry keyed on whatever the caller typed.
  const validId = SHARE_ID_PATTERN.test(id);

  const cache = caches.default;
  const cached = await cache.match(c.req.raw);
  if (cached) return cached;

  const row = !validId
    ? null
    : await c.env.DB.prepare('SELECT preview, expires_at FROM systems WHERE id = ?')
        .bind(id)
        .first<{ preview: ArrayBuffer | null; expires_at: number | null }>();

  // Deliberately does NOT extend the share's life. This endpoint is hit by
  // crawlers and by caches re-validating, which says nothing about whether a
  // person still wants the share — the page view and the API read are what
  // count for that.
  const live = row && (row.expires_at === null || row.expires_at >= Date.now());

  // No stored card (an API-created share, or a browser that couldn't
  // rasterize) falls back to the site-wide image rather than 404ing, so the
  // og:image on the share page is never a broken link.
  if (!live || !row.preview) {
    return c.env.ASSETS.fetch(new Request(new URL('/og-image.png', c.req.raw.url), c.req.raw));
  }

  const response = new Response(row.preview, { headers: PREVIEW_RESPONSE_HEADERS });
  c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));
  return response;
});

/**
 * Fetches the SPA shell. Requested as "/" rather than "/index.html" because
 * the assets binding's html_handling normalizes the extension form and
 * answers with a 307 — which, passed through, is what a browser follows
 * instead of rendering the page.
 */
function fetchAppShell(c: Context<{ Bindings: Env }>): Promise<Response> {
  return c.env.ASSETS.fetch(new Request(new URL('/', c.req.raw.url), c.req.raw));
}

// Inject real per-share Open Graph/Twitter meta tags into the SPA shell for
// /s/:id, so pasting a share link into Slack/Discord/iMessage shows the
// system's actual name instead of the generic site-wide card, and the
// system's actual map instead of the generic site-wide image.
async function handleSharePage(c: Context<{ Bindings: Env }>) {
  const id = c.req.param('id');

  // Fetch unconditionally so a missing/expired share falls through to
  // exactly what the plain catch-all below would have returned — this
  // route must never change the existing 404/SPA behavior.
  const assetResponse = await fetchAppShell(c);
  const share = id ? await getActiveShare(c.env.DB, id) : null;
  if (!share) {
    // The SPA still renders and explains itself, but the status has to say
    // "gone". Answering 200 makes an expired share look like a real page to
    // every crawler and link unfurler that sees it.
    const missing = withHtmlSecurityHeaders(assetResponse, "'none'");
    return new Response(missing.body, { status: 404, headers: missing.headers });
  }

  // A visit to the share page counts as the share still being wanted.
  const touch = touchExpiry(c.env.DB, share);
  if (touch) c.executionCtx.waitUntil(touch);

  const title = share.system.name || 'TransitMapper';
  const description = `${share.system.stations.length} stations, ${share.system.services.length} lines`;
  const shareUrl = `${c.env.SITE_URL}/s/${share.id}`;
  const previewUrl = `${c.env.SITE_URL}/s/${share.id}/preview.png`;
  const oembedUrl = `${c.env.SITE_URL}/api/oembed?url=${encodeURIComponent(shareUrl)}&format=json`;

  // `system.name` is unauthenticated, user-supplied text with no character
  // sanitization at write time — using HTMLRewriter's element API (rather
  // than string/template concatenation into raw HTML) is what keeps this
  // safe, since it escapes values for their context automatically.
  const transformed = new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(`${title} · TransitMapper`, { html: false });
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute('content', title);
      },
    })
    .on('meta[property="og:description"]', {
      element(el) {
        el.setAttribute('content', description);
      },
    })
    .on('meta[property="og:url"]', {
      element(el) {
        el.setAttribute('content', shareUrl);
      },
    })
    .on('meta[name="twitter:title"]', {
      element(el) {
        el.setAttribute('content', title);
      },
    })
    .on('meta[name="twitter:description"]', {
      element(el) {
        el.setAttribute('content', description);
      },
    })
    .on('meta[property="og:image"]', {
      element(el) {
        el.setAttribute('content', previewUrl);
      },
    })
    .on('meta[name="twitter:image"]', {
      element(el) {
        el.setAttribute('content', previewUrl);
      },
    })
    .on('link[rel="canonical"]', {
      element(el) {
        el.setAttribute('href', shareUrl);
      },
    })
    // oEmbed discovery is appended rather than rewritten in place: the shell
    // carries no placeholder for it, and only share pages are embeddable —
    // the homepage has nothing to advertise. `oembedUrl` is entirely
    // Worker-built (SITE_URL plus an encoded id), so there's no user text in
    // this markup.
    .on('head', {
      element(el) {
        el.append(
          `<link rel="alternate" type="application/json+oembed" href="${oembedUrl}" title="TransitMapper oEmbed">`,
          {
            html: true,
          },
        );
      },
    })
    .transform(assetResponse);

  // A share page is the full editor loaded read-only, not an embed surface —
  // /e/:id is the one thing on this origin that's meant to be framed.
  return withHtmlSecurityHeaders(transformed, "'none'");
}

app.get('/s/:id', handleSharePage);
app.get('/s/:id/', handleSharePage);

// The embeddable read-only map. Served from its own built entry (embed.html)
// rather than the SPA shell, so an iframe in someone's article downloads the
// map and not the editor. The path doesn't reach the assets binding on its
// own — SPA fallback would hand back index.html — so it's rewritten here.
async function handleEmbedPage(c: Context<{ Bindings: Env }>) {
  // "/embed", not "/embed.html": the assets binding's default html_handling
  // redirects the extension form, and a 307 is not what an iframe should get.
  const embedRequest = new Request(new URL('/embed', c.req.raw.url), c.req.raw);
  const asset = await c.env.ASSETS.fetch(embedRequest);

  // Framing is opt-in, per-path. This is the ONLY route on the origin that
  // any site may frame; the lockdown for everything else is applied below.
  // The embed shows nothing a share link doesn't already show to anyone who
  // has it, and it carries no credentials or account state, so there's no
  // clickjacking surface to protect here.
  const response = withHtmlSecurityHeaders(asset, '*');
  response.headers.delete('x-frame-options');
  return response;
}

app.get('/e/:id', handleEmbedPage);
app.get('/e/:id/', handleEmbedPage);

// Only the share and embed prefixes reach the Worker (see run_worker_first in
// wrangler.toml), so this catches ids under them that matched no earlier
// route. Assets and ordinary client routes never get here — they're served
// straight from the assets binding, which also owns the SPA fallback again.
//
// The editor is never framable: it's a real application surface, and the
// embed route above is the one deliberate exception.
app.all('*', async (c) => {
  const shell = await fetchAppShell(c);
  return withHtmlSecurityHeaders(shell, "'none'");
});

async function scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM systems WHERE expires_at IS NOT NULL AND expires_at < ?')
    .bind(Date.now())
    .run();
}

export default {
  fetch: app.fetch,
  scheduled,
};
