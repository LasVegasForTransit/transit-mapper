// Shared request/response shapes for the share API. Imported by both the React
// client and the Cloudflare Worker so the wire format stays in one place.
import type { TransitSystem } from '../model/system';

/** The Worker rejects request bodies above this exact UTF-8 byte count.
 * Exported as part of the wire contract so clients can refuse an oversized
 * document before rendering a preview or starting an upload. */
export const MAX_SHARE_BODY_BYTES = 1_000_000;

export interface SerializedShareRequest {
  /** Canonical system JSON, reused for local change detection. */
  data: string;
  /** Complete POST/PATCH request body. */
  body: string;
  /** UTF-8 bytes, matching the Worker's enforcement rather than JS length. */
  byteLength: number;
}

/** Serialize a share without traversing a large system twice. Constructing
 * the small envelope around the already-serialized value is valid JSON and
 * leaves the Worker as the authority that parses and validates the document. */
export function serializeShareRequest(
  system: TransitSystem,
  preview?: string,
): SerializedShareRequest {
  return serializeShareRequestFromData(JSON.stringify(system), preview);
}

/** Add the request envelope to system JSON that was already produced for
 * change detection. The caller is responsible for passing JSON created from a
 * TransitSystem; the Worker still parses and validates it at the trust boundary. */
export function serializeShareRequestFromData(
  data: string,
  preview?: string,
): SerializedShareRequest {
  const body =
    preview === undefined
      ? `{"system":${data}}`
      : `{"system":${data},"preview":${JSON.stringify(preview)}}`;
  return {
    data,
    body,
    byteLength: new TextEncoder().encode(body).byteLength,
  };
}

export function shareRequestFits(request: SerializedShareRequest): boolean {
  return request.byteLength <= MAX_SHARE_BODY_BYTES;
}

export interface CreateShareRequest {
  system: TransitSystem;
  /**
   * The rendered social card as base64 PNG bytes, drawn by the sharer's
   * browser (a free-plan Worker hasn't the CPU to draw it server-side).
   * Optional: a client that can't rasterize, or an API caller with no
   * browser, simply omits it and the share falls back to the site-wide image.
   *
   * A PATCH can replace this too, but only by presenting the edit token
   * handed out at creation — holding the share id alone is not enough to
   * replace someone else's card.
   */
  preview?: string;
}

export interface CreateShareResponse {
  id: string;
  /** One-time secret returned only for anonymous shares. The browser keeps
   *  it so the share can be adopted on sign-in; the server stores only its
   *  hash. Absent when the share already has an owner. */
  claimToken?: string;
  /**
   * One-time secret proving this browser created the share, needed to PATCH
   * or DELETE it later. The server stores only its hash. Present only when
   * this request actually inserted a new row — a request that got deduped
   * onto an existing share (see CreateShareRequest) never proved ownership
   * of that row, so it gets the id back but not a token for it.
   */
  editToken?: string;
}

/** Body for PATCH /api/systems/:id. Same shape as creation: the whole
 *  snapshot is replaced in place, there's no partial-update concept. The
 *  edit token goes in the `x-edit-token` header, not the body, so it never
 *  ends up serialized next to the content it authorizes changing. */
export type UpdateShareRequest = CreateShareRequest;

export interface GetShareResponse {
  id: string;
  system: TransitSystem;
  createdAt: number;
}

export interface ApiError {
  error: string;
}
