import { parseSystem } from "@transitmapper/core/model/serialize";
import type { TransitSystem } from "@transitmapper/core/model/system";
import type { CreateShareRequest, CreateShareResponse, GetShareResponse } from "@transitmapper/core/share/contract";
import { renderPreviewPng, toBase64 } from "./previewImage";

/** POST a system snapshot; returns the share id.
 *
 *  The social card is drawn here, in the browser, and sent along with the
 *  system — the Worker can't afford to draw it (see share/previewImage.ts).
 *  Best-effort: if rasterizing fails, the share is created without one rather
 *  than failing outright. */
export async function createShare(system: TransitSystem): Promise<string> {
  const png = await renderPreviewPng(system);
  const body: CreateShareRequest = { system, ...(png ? { preview: toBase64(png) } : {}) };
  const res = await fetch("/api/systems", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Share failed (${res.status}): ${msg}`);
  }
  const data = (await res.json()) as CreateShareResponse;
  return data.id;
}

/** Fetch a shared system by id and validate it. */
export async function fetchShare(id: string): Promise<TransitSystem> {
  const res = await fetch(`/api/systems/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error("This shared system was not found.");
  if (!res.ok) throw new Error(`Failed to load shared system (${res.status}).`);
  const data = (await res.json()) as GetShareResponse;
  return parseSystem(data.system);
}
