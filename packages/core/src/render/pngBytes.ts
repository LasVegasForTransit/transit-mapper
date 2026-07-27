// Validation for a PNG that arrived from somewhere we don't control.
//
// Share cards are rasterized by the sharer's browser and uploaded, because a
// free-plan Worker doesn't have the CPU budget to draw one itself. That means
// the bytes are user input: the endpoint accepting them has to be satisfied
// they're a PNG of the expected size, not merely that someone said so.
//
// This can't make the pixels trustworthy — nothing short of re-rendering
// server-side could, which is the thing we can't afford. What it does is keep
// the endpoint from becoming general-purpose file storage: bounded size,
// actually a PNG, and exactly the dimensions a card has.

/** Bytes 0-7 of every PNG. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Generous against a real card (~25KB, ~60KB for a dense system), mean against
 * anything trying to use this as a file host, and far below D1's 2MB row
 * ceiling.
 *
 * It also bounds the worst case for storage: the free D1 allowance is 500MB,
 * so this cap is what stands between a scripted attacker and filling it. That
 * is a rate-limiting problem more than a size problem — see the deployment
 * note in docs/explanation/sharing-surfaces.md.
 */
export const MAX_PREVIEW_BYTES = 120_000;

export interface PngDimensions {
  width: number;
  height: number;
}

/** Reads width and height out of a PNG's IHDR chunk, which the spec requires
 *  to be first: 8-byte signature, 4-byte length, 4-byte type, then two
 *  big-endian 32-bit integers. Returns null if the bytes aren't a PNG. */
export function pngDimensions(bytes: Uint8Array): PngDimensions | null {
  if (bytes.length < 24) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  // Bytes 12-15 are the chunk type; anything but IHDR here means the file is
  // malformed or is something else wearing a PNG signature.
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52)
    return null;

  const readU32 = (at: number) =>
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  return { width: readU32(16), height: readU32(20) };
}

/**
 * Walks the PNG chunk chain and reports whether the file is exactly a PNG and
 * nothing else: IHDR first, IEND last, and not a single byte after it.
 *
 * This is what rejects polyglots. A file can carry a valid PNG header and then
 * append arbitrary content — markup, an archive, a script — and every check
 * that only reads the header will wave it through. Serving such a file is
 * already defanged by the response headers, but storing one at all is worse
 * than not, and the chain is cheap to walk: chunk sizes only, no pixel
 * decoding, no CRC verification.
 */
function hasCleanChunkChain(bytes: Uint8Array): boolean {
  const readU32 = (at: number) =>
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  const typeAt = (at: number) =>
    String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

  let offset = 8; // past the signature
  let sawIhdrFirst = false;
  while (offset + 12 <= bytes.length) {
    const length = readU32(offset);
    const type = typeAt(offset + 4);
    if (offset === 8 && type !== 'IHDR') return false;
    if (offset === 8) sawIhdrFirst = true;

    // length + 12 is the whole chunk (4 length, 4 type, data, 4 CRC). Guard
    // against a declared length that overruns the buffer or wraps.
    const next = offset + 12 + length;
    if (!Number.isSafeInteger(next) || next > bytes.length) return false;
    if (type === 'IEND') return sawIhdrFirst && next === bytes.length;
    offset = next;
  }
  return false; // ran out of bytes without a terminating IEND
}

export interface PreviewCheck {
  ok: boolean;
  /** Why it was rejected — safe to return to the caller; it describes their
   *  own upload and nothing about us. */
  reason?: string;
}

/** Whether these bytes are acceptable as a stored preview card. */
export function checkPreviewPng(bytes: Uint8Array, expected: PngDimensions): PreviewCheck {
  if (bytes.length === 0) return { ok: false, reason: 'Preview image is empty' };
  if (bytes.length > MAX_PREVIEW_BYTES) {
    return { ok: false, reason: `Preview image is larger than ${MAX_PREVIEW_BYTES} bytes` };
  }
  const size = pngDimensions(bytes);
  if (!size) return { ok: false, reason: 'Preview image is not a PNG' };
  if (size.width !== expected.width || size.height !== expected.height) {
    return {
      ok: false,
      reason: `Preview image must be ${expected.width}x${expected.height}, got ${size.width}x${size.height}`,
    };
  }
  if (!hasCleanChunkChain(bytes)) {
    return { ok: false, reason: 'Preview image is not a well-formed PNG' };
  }
  return { ok: true };
}
