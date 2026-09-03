export type FramePart = string | Uint8Array;

const MAXIMUM_UNSIGNED_32 = 0xffff_ffff;
const encoder = new TextEncoder();

function unsigned32(value: number, label: string): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAXIMUM_UNSIGNED_32) {
    throw new Error(`${label} exceeds the unsigned 32-bit limit.`);
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function strictUtf8(value: string): Uint8Array {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw new Error('Frame text contains an unpaired surrogate.');
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error('Frame text contains an unpaired surrogate.');
    }
  }
  return encoder.encode(value);
}

function partBytes(part: FramePart): Uint8Array {
  return typeof part === 'string' ? strictUtf8(part) : part;
}

/** Encodes identity parts without changing text case, normalization, or bytes. */
export function frame(parts: readonly FramePart[]): Uint8Array {
  const encodedParts = parts.map(partBytes);
  let totalLength = 4;
  for (const part of encodedParts) {
    unsigned32(part.length, 'Frame part byte length');
    totalLength += 4 + part.length;
    if (!Number.isSafeInteger(totalLength) || totalLength > MAXIMUM_UNSIGNED_32) {
      throw new Error('Framed bytes exceed the unsigned 32-bit limit.');
    }
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  result.set(unsigned32(encodedParts.length, 'Frame part count'), offset);
  offset += 4;
  for (const part of encodedParts) {
    result.set(unsigned32(part.length, 'Frame part byte length'), offset);
    offset += 4;
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
