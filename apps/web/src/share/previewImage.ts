import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from '@transitmapper/core/render/preview-size';
import { renderPreviewMarkup, type RenderPreviewMarkupOptions } from './previewWorker';

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
const PNG_ENCODE_TIMEOUT_MS = 5000;

export interface CanvasPngSource {
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

export interface CanvasToPngBlobOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Preview rendering was canceled.', 'AbortError');
}

function decodeSvg(markup: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  // A blob: URL rather than a data: URL — same-origin, no base64 round-trip,
  // and revocable. The card contains no external references (and, at unfurl
  // size, no text at all), so nothing here reaches the network or taints the
  // canvas it gets drawn into.
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (outcome: { image: HTMLImageElement } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      URL.revokeObjectURL(url);
      image.onload = null;
      image.onerror = null;
      if ('image' in outcome) resolve(outcome.image);
      else reject(outcome.error);
    };
    const onAbort = () => {
      if (signal) finish({ error: abortError(signal) });
    };
    const timer = setTimeout(() => {
      finish({ error: new Error('Timed out rasterizing the preview image') });
    }, DECODE_TIMEOUT_MS);
    image.onload = () => finish({ image });
    image.onerror = () => finish({ error: new Error('Could not rasterize the preview image') });
    signal?.addEventListener('abort', onAbort, { once: true });
    image.src = url;
  });
}

/** Canvas encoding has a callback-only browser API, and some failed/lost
 * contexts never invoke that callback. The preview is optional, so a bounded
 * rejection is safer than leaving the entire share operation pending. */
export function canvasToPngBlob(
  canvas: CanvasPngSource,
  options: CanvasToPngBlobOptions = {},
): Promise<Blob | null> {
  if (options.signal?.aborted) return Promise.reject(abortError(options.signal));
  return new Promise<Blob | null>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: { blob: Blob | null } | { error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if ('blob' in outcome) resolve(outcome.blob);
      else reject(outcome.error);
    };
    const onAbort = () => {
      if (options.signal) finish({ error: abortError(options.signal) });
    };
    const timer = setTimeout(
      () => finish({ error: new Error('Timed out encoding the preview image') }),
      options.timeoutMs ?? PNG_ENCODE_TIMEOUT_MS,
    );
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      canvas.toBlob((blob) => finish({ blob }), 'image/png');
    } catch (error) {
      finish({
        error: error instanceof Error ? error : new Error('Could not encode the preview image'),
      });
    }
  });
}

/**
 * Draws the share card and returns it as PNG bytes at Open Graph card size,
 * or null if the browser can't produce one. A missing preview is not an error
 * — the share still works, and its link just falls back to the site-wide
 * image — so every caller should treat this as best-effort.
 */
export async function renderPreviewPng(
  systemData: string,
  options: RenderPreviewMarkupOptions = {},
): Promise<Uint8Array | null> {
  try {
    const markup = await renderPreviewMarkup(systemData, options);
    const image = await decodeSvg(markup, options.signal);
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // The card is composed at half this size; drawing it into the full-size
    // canvas is the same 2x scale-up the server renderer used to do, and costs
    // no sharpness because the source is vector.
    ctx.drawImage(image, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);

    const blob = await canvasToPngBlob(canvas, { signal: options.signal });
    if (options.signal?.aborted) throw abortError(options.signal);
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    if (options.signal?.aborted) throw abortError(options.signal);
    return null;
  }
}

/** PNG bytes as base64, for embedding in the share-creation JSON body. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked because String.fromCharCode(...bytes) blows the argument limit on
  // anything bigger than a few tens of kilobytes.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
