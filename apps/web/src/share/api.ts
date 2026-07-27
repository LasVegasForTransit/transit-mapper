import { parseSystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type {
  CreateShareRequest,
  CreateShareResponse,
  GetShareResponse,
} from '@transitmapper/core/share/contract';
import { renderPreviewPng, toBase64 } from './previewImage';
import { getMyShare, removeMyShare, setMyShare } from './myShares';

async function sharePayload(system: TransitSystem): Promise<{ body: string; data: string }> {
  const png = await renderPreviewPng(system);
  const data = JSON.stringify(system);
  const body: CreateShareRequest = { system, ...(png ? { preview: toBase64(png) } : {}) };
  return { body: JSON.stringify(body), data };
}

/** POST a system snapshot; returns the share id and, if this request
 *  actually created a new row, the edit token for it.
 *
 *  The social card is drawn here, in the browser, and sent along with the
 *  system — the Worker can't afford to draw it (see share/previewImage.ts).
 *  Best-effort: if rasterizing fails, the share is created without one rather
 *  than failing outright. */
async function createShare(system: TransitSystem): Promise<CreateShareResponse & { data: string }> {
  const { body, data } = await sharePayload(system);
  const res = await fetch('/api/systems', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Share failed (${res.status}): ${msg}`);
  }
  return { ...((await res.json()) as CreateShareResponse), data };
}

async function updateShare(
  shareId: string,
  editToken: string,
  system: TransitSystem,
): Promise<string> {
  const { body, data } = await sharePayload(system);
  const res = await fetch(`/api/systems/${encodeURIComponent(shareId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-edit-token': editToken },
    body,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Updating the share failed (${res.status}): ${msg}`);
  }
  return data;
}

function shareUrl(id: string): string {
  return `${window.location.origin}/s/${id}`;
}

/**
 * The button this app actually calls "Share": idempotent per document. Opens
 * the same link every time nothing's changed, updates that link in place if
 * the document has, and only ever mints a new row the first time a document
 * is shared (or if this browser has never held its edit token — see
 * myShares.ts).
 */
export async function getOrCreateShare(system: TransitSystem): Promise<string> {
  const existing = getMyShare(system.id);
  const data = JSON.stringify(system);

  if (existing && existing.lastSharedData === data) return shareUrl(existing.shareId);

  if (existing) {
    await updateShare(existing.shareId, existing.editToken, system);
    setMyShare({ ...existing, lastSharedData: data, updatedAt: Date.now() });
    return shareUrl(existing.shareId);
  }

  const created = await createShare(system);
  if (created.editToken) {
    setMyShare({
      documentId: system.id,
      shareId: created.id,
      editToken: created.editToken,
      lastSharedData: created.data,
      updatedAt: Date.now(),
    });
  }
  return shareUrl(created.id);
}

/** Revokes the share this browser holds for a document, if any. A no-op
 *  (returns false) when there's nothing this browser can authorize revoking —
 *  either it was never shared from here, or the share came back deduped onto
 *  someone else's row (see CreateShareResponse.editToken). */
export async function stopSharing(documentId: string): Promise<boolean> {
  const existing = getMyShare(documentId);
  if (!existing) return false;
  const res = await fetch(`/api/systems/${encodeURIComponent(existing.shareId)}`, {
    method: 'DELETE',
    headers: { 'x-edit-token': existing.editToken },
  });
  if (!res.ok && res.status !== 404) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Couldn't stop sharing (${res.status}): ${msg}`);
  }
  removeMyShare(documentId);
  return true;
}

/** Fetch a shared system by id and validate it. */
export async function fetchShare(id: string): Promise<TransitSystem> {
  const res = await fetch(`/api/systems/${encodeURIComponent(id)}`);
  if (res.status === 404) throw new Error('This shared system was not found.');
  if (!res.ok) throw new Error(`Failed to load shared system (${res.status}).`);
  const data = (await res.json()) as GetShareResponse;
  return parseSystem(data.system);
}
