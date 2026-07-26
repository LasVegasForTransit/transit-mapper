// Shared request/response shapes for the share API. Imported by both the React
// client and the Cloudflare Worker so the wire format stays in one place.
import type { TransitSystem } from "../model/system";

export interface CreateShareRequest {
  system: TransitSystem;
  /**
   * The rendered social card as base64 PNG bytes, drawn by the sharer's
   * browser (a free-plan Worker hasn't the CPU to draw it server-side).
   * Optional: a client that can't rasterize, or an API caller with no
   * browser, simply omits it and the share falls back to the site-wide image.
   *
   * Accepted only here, at creation. There is deliberately no route that
   * updates an existing share's preview — that would let anyone holding a
   * share id replace someone else's card.
   */
  preview?: string;
}

export interface CreateShareResponse {
  id: string;
  /** One-time secret returned only for anonymous shares. The browser keeps
   *  it so the share can be adopted on sign-in; the server stores only its
   *  hash. Absent when the share already has an owner. */
  claimToken?: string;
}

export interface GetShareResponse {
  id: string;
  system: TransitSystem;
  createdAt: number;
}

export interface ApiError {
  error: string;
}
