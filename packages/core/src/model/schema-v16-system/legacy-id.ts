type LegacyIdPart = string | number;

/**
 * Preserves IDs that schema v16 never stored directly. The byte-length framing
 * keeps punctuation in old IDs from changing the generated identity.
 */
export function legacyDerivedId(kind: string, ...parts: LegacyIdPart[]): string {
  if (kind.length === 0) throw new Error('Legacy derived ID kind must not be empty.');
  const framed = parts.map((part) => {
    const text = typeof part === 'number' ? legacyNumber(part) : part;
    return `${new TextEncoder().encode(text).byteLength}:${text}`;
  });
  return `v16:${kind}${framed.length === 0 ? '' : `:${framed.join(':')}`}`;
}

function legacyNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Legacy derived ID numbers must be nonnegative safe integers.');
  }
  return String(value);
}
