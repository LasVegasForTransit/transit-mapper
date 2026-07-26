import { previewSvg, PREVIEW_HEIGHT, PREVIEW_WIDTH } from "@transitmapper/core/render/preview";
import type { TransitSystem } from "@transitmapper/core/model/system";

// Rasterizing the share card, in the browser, at share time.
//
// The Worker used to do this with resvg, but a free-plan Worker gets 10ms of
// CPU per request and drawing a card costs closer to 65ms. The browser has no
// such budget, is already sitting on the system, and only does this once per
// share — so it draws the card and uploads it, and the Worker's job shrinks to
// handing bytes back.
//
// Nothing here is trusted by the server: see core's render/pngBytes.ts for
// what the upload has to satisfy before it's stored.

/** How long to wait for the browser to decode our own SVG before giving up.
 *  Share creation must not hang on a preview that isn't essential. */
const DECODE_TIMEOUT_MS = 5000;

function decodeSvg(markup: string): Promise<HTMLImageElement> {
  // A blob: URL rather than a data: URL — same-origin, no base64 round-trip,
  // and revocable. The card contains no external references (and, at unfurl
  // size, no text at all), so nothing here reaches the network or taints the
  // canvas it gets drawn into.
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error("Timed out rasterizing the preview image"));
    }, DECODE_TIMEOUT_MS);
    image.onload = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error("Could not rasterize the preview image"));
    };
    image.src = url;
  });
}

/**
 * Draws the share card and returns it as PNG bytes at Open Graph card size,
 * or null if the browser can't produce one. A missing preview is not an error
 * — the share still works, and its link just falls back to the site-wide
 * image — so every caller should treat this as best-effort.
 */
export async function renderPreviewPng(system: TransitSystem): Promise<Uint8Array | null> {
  try {
    const image = await decodeSvg(previewSvg(system));
    const canvas = document.createElement("canvas");
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // The card is composed at half this size; drawing it into the full-size
    // canvas is the same 2x scale-up the server renderer used to do, and costs
    // no sharpness because the source is vector.
    ctx.drawImage(image, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/** PNG bytes as base64, for embedding in the share-creation JSON body. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked because String.fromCharCode(...bytes) blows the argument limit on
  // anything bigger than a few tens of kilobytes.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
