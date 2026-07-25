import { Hono, type Context } from "hono";
import { parseSystem } from "@transitmapper/core/model/serialize";
import { shortId } from "@transitmapper/core/model/ids";
import type { TransitSystem } from "@transitmapper/core/model/system";
import type {
  CreateShareResponse,
  GetShareResponse,
} from "@transitmapper/core/share/contract";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_URL: string;
}

const MAX_BODY_BYTES = 1_000_000; // ~1 MB — generous for a hand-drawn system.
const ANONYMOUS_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days.

const app = new Hono<{ Bindings: Env }>();

interface ShareRow {
  id: string;
  system: TransitSystem;
  createdAt: number;
}

// Look up a share by id, treating an expired-but-not-yet-swept row as if it
// doesn't exist (and deleting it on the spot) — shared by the JSON API and
// the /s/:id HTML route so the expiry rule only lives in one place.
async function getActiveShare(db: D1Database, id: string): Promise<ShareRow | null> {
  const row = await db
    .prepare("SELECT id, data, created_at, expires_at FROM systems WHERE id = ?")
    .bind(id)
    .first<{ id: string; data: string; created_at: number; expires_at: number | null }>();

  if (!row) return null;

  if (row.expires_at !== null && row.expires_at < Date.now()) {
    await db.prepare("DELETE FROM systems WHERE id = ?").bind(id).run();
    return null;
  }

  return { id: row.id, system: JSON.parse(row.data), createdAt: row.created_at };
}

// Create an immutable snapshot of a system and return its share id.
app.post("/api/systems", async (c) => {
  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return c.json({ error: "System too large" }, 413);
  }

  let system;
  try {
    const body = JSON.parse(raw) as { system?: unknown };
    system = parseSystem(body.system);
  } catch (e) {
    return c.json({ error: `Invalid system: ${(e as Error).message}` }, 400);
  }

  const id = shortId(10);
  const now = Date.now();
  const expiresAt = now + ANONYMOUS_SHARE_TTL_MS;
  await c.env.DB.prepare(
    "INSERT INTO systems (id, name, data, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, system.name.slice(0, 200), JSON.stringify(system), now, expiresAt)
    .run();

  return c.json<CreateShareResponse>({ id });
});

// Fetch a shared system snapshot.
app.get("/api/systems/:id", async (c) => {
  const share = await getActiveShare(c.env.DB, c.req.param("id"));
  if (!share) return c.json({ error: "Not found" }, 404);

  return c.json<GetShareResponse>(share);
});

// Proxy RTC Southern Nevada's real GTFS feed — its own host doesn't send
// CORS headers, so the browser can't fetch it directly; this endpoint (same
// origin as the app) sidesteps that. Passed straight through, not cached —
// the feed is ~6 MB and imported rarely, not worth a KV/R2 cache layer yet.
app.get("/api/gtfs/rtc", async (c) => {
  const upstream = await fetch("https://developer.rtcsnv.com/transitData/google_transit.zip");
  if (!upstream.ok || !upstream.body) {
    return c.json({ error: `RTC GTFS feed unavailable (${upstream.status})` }, 502);
  }
  return new Response(upstream.body, {
    headers: { "content-type": "application/zip" },
  });
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// Inject real per-share Open Graph/Twitter meta tags into the SPA shell for
// /s/:id, so pasting a share link into Slack/Discord/iMessage shows the
// system's actual name instead of the generic site-wide card. og:image stays
// the static default — a per-system preview image needs a server-side map
// renderer that doesn't exist yet (tracked separately).
async function handleSharePage(c: Context<{ Bindings: Env }>) {
  const id = c.req.param("id");

  // Fetch unconditionally so a missing/expired share falls through to
  // exactly what the plain catch-all below would have returned — this
  // route must never change the existing 404/SPA behavior.
  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  const share = id ? await getActiveShare(c.env.DB, id) : null;
  if (!share) return assetResponse;

  const title = share.system.name || "TransitMapper";
  const description = `${share.system.stations.length} stations, ${share.system.services.length} lines`;
  const shareUrl = `${c.env.SITE_URL}${new URL(c.req.raw.url).pathname}`;

  // `system.name` is unauthenticated, user-supplied text with no character
  // sanitization at write time — using HTMLRewriter's element API (rather
  // than string/template concatenation into raw HTML) is what keeps this
  // safe, since it escapes values for their context automatically.
  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(`${title} · TransitMapper`, { html: false });
      },
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute("content", title);
      },
    })
    .on('meta[property="og:description"]', {
      element(el) {
        el.setAttribute("content", description);
      },
    })
    .on('meta[property="og:url"]', {
      element(el) {
        el.setAttribute("content", shareUrl);
      },
    })
    .on('meta[name="twitter:title"]', {
      element(el) {
        el.setAttribute("content", title);
      },
    })
    .on('meta[name="twitter:description"]', {
      element(el) {
        el.setAttribute("content", description);
      },
    })
    .on('link[rel="canonical"]', {
      element(el) {
        el.setAttribute("href", shareUrl);
      },
    })
    .transform(assetResponse);
}

app.get("/s/:id", handleSharePage);
app.get("/s/:id/", handleSharePage);

// Everything else is a static asset (with SPA fallback to index.html for
// client routes), served by the assets binding.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

async function scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM systems WHERE expires_at IS NOT NULL AND expires_at < ?",
  )
    .bind(Date.now())
    .run();
}

export default {
  fetch: app.fetch,
  scheduled,
};
