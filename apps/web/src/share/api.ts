import { parseSystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type {
  CreateShareResponse,
  GetShareResponse,
  SerializedShareRequest,
} from '@transitmapper/core/share/contract';
import { serializeShareRequest, shareRequestFits } from '@transitmapper/core/share/contract';
import { renderPreviewPng, toBase64 } from './previewImage';
import { getMyShare, removeMyShare, setMyShare } from './myShares';
import { fetchWithTimeout } from '../network/fetchWithTimeout';
import {
  createCancelableFlight,
  joinCancelableFlight,
  type CancelableFlight,
} from '../network/cancelableFlight';
import { addPreviewToSharePayload, ShareTooLargeError } from './publish';

export interface ShareRequestOptions {
  signal?: AbortSignal;
}

interface ShareFlight extends CancelableFlight<string> {
  data: string;
}

const shareFlights = new Map<string, ShareFlight>();

async function sharePayload(
  request: SerializedShareRequest,
  signal: AbortSignal,
): Promise<SerializedShareRequest> {
  return addPreviewToSharePayload(request, {
    signal,
    renderPreview: async () => {
      const png = await renderPreviewPng(request.data, { signal });
      return png ? toBase64(png) : null;
    },
  });
}

/** POST a system snapshot; returns the share id and, if this request
 *  actually created a new row, the edit token for it.
 *
 *  The social card is drawn here, in the browser, and sent along with the
 *  system — the Worker can't afford to draw it (see share/previewImage.ts).
 *  Best-effort: if rasterizing fails, the share is created without one rather
 *  than failing outright. */
async function createShare(
  request: SerializedShareRequest,
  signal: AbortSignal,
): Promise<CreateShareResponse & { data: string }> {
  const res = await fetchWithTimeout(
    '/api/systems',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: request.body,
    },
    { signal },
  );
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Share failed (${res.status}): ${msg}`);
  }
  return { ...((await res.json()) as CreateShareResponse), data: request.data };
}

async function updateShare(
  shareId: string,
  editToken: string,
  request: SerializedShareRequest,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetchWithTimeout(
    `/api/systems/${encodeURIComponent(shareId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-edit-token': editToken },
      body: request.body,
    },
    { signal },
  );
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Updating the share failed (${res.status}): ${msg}`);
  }
  return request.data;
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
async function publishShare(
  system: TransitSystem,
  initialRequest: SerializedShareRequest,
  signal: AbortSignal,
): Promise<string> {
  const existing = getMyShare(system.id);
  if (existing && existing.lastSharedData === initialRequest.data)
    return shareUrl(existing.shareId);
  const request = await sharePayload(initialRequest, signal);

  if (existing) {
    await updateShare(existing.shareId, existing.editToken, request, signal);
    setMyShare({ ...existing, lastSharedData: request.data, updatedAt: Date.now() });
    return shareUrl(existing.shareId);
  }

  const created = await createShare(request, signal);
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

/** Publishing is latest-wins per document. Reopening the dialog for an
 * unchanged snapshot joins the in-flight request; asking to publish a newer
 * snapshot cancels the obsolete preview/upload before starting another. */
export function getOrCreateShare(
  system: TransitSystem,
  options: ShareRequestOptions = {},
): Promise<string> {
  const initialRequest = serializeShareRequest(system);
  if (!shareRequestFits(initialRequest)) {
    return Promise.reject(new ShareTooLargeError(initialRequest.byteLength));
  }
  if (options.signal?.aborted) {
    return Promise.reject(
      options.signal.reason instanceof Error
        ? options.signal.reason
        : new DOMException('The operation was canceled.', 'AbortError'),
    );
  }

  const active = shareFlights.get(system.id);
  if (active?.data === initialRequest.data && !active.controller.signal.aborted) {
    return joinCancelableFlight(active, options.signal);
  }
  active?.controller.abort(new DOMException('Superseded by a newer share.', 'AbortError'));

  const base = createCancelableFlight((signal) => publishShare(system, initialRequest, signal));
  const flight: ShareFlight = { data: initialRequest.data, ...base };
  shareFlights.set(system.id, flight);
  const remove = () => {
    if (shareFlights.get(system.id) === flight) shareFlights.delete(system.id);
  };
  flight.promise.then(remove, remove);
  return joinCancelableFlight(flight, options.signal);
}

/** Revokes the share this browser holds for a document, if any. A no-op
 *  (returns false) when there's nothing this browser can authorize revoking —
 *  either it was never shared from here, or the share came back deduped onto
 *  someone else's row (see CreateShareResponse.editToken). */
export async function stopSharing(
  documentId: string,
  options: ShareRequestOptions = {},
): Promise<boolean> {
  const existing = getMyShare(documentId);
  if (!existing) return false;
  const res = await fetchWithTimeout(
    `/api/systems/${encodeURIComponent(existing.shareId)}`,
    {
      method: 'DELETE',
      headers: { 'x-edit-token': existing.editToken },
    },
    options,
  );
  if (!res.ok && res.status !== 404) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Couldn't stop sharing (${res.status}): ${msg}`);
  }
  removeMyShare(documentId);
  return true;
}

/** Fetch a shared system by id and validate it. */
export async function fetchShare(
  id: string,
  options: ShareRequestOptions = {},
): Promise<TransitSystem> {
  const res = await fetchWithTimeout(`/api/systems/${encodeURIComponent(id)}`, {}, options);
  if (res.status === 404) throw new Error('This shared system was not found.');
  if (!res.ok) throw new Error(`Failed to load shared system (${res.status}).`);
  const data = (await res.json()) as GetShareResponse;
  return parseSystem(data.system);
}
