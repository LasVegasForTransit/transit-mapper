export type DerivedIdPart = string | number;

function framedNumber(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Derived ID numbers must be nonnegative safe integers.');
  }
  return String(value);
}

/**
 * Builds an identity a schema never stored directly.
 *
 * The byte-length framing is what stops punctuation inside a part from
 * changing the generated identity: without it `a:b` and `a` + `b` collide, and
 * two different entities would share a fragment ID. The schema prefix keeps
 * v16-derived and v17-derived identities in separate spaces even when every
 * other part matches, so one cannot be mistaken for the other after a
 * migration.
 */
export function derivedId(
  schema: string,
  kind: string,
  ...parts: readonly DerivedIdPart[]
): string {
  if (kind.length === 0) throw new Error('Derived ID kind must not be empty.');
  const encoder = new TextEncoder();
  const framed = parts.map((part) => {
    const text = typeof part === 'number' ? framedNumber(part) : part;
    return `${encoder.encode(text).byteLength}:${text}`;
  });
  return `${schema}:${kind}${framed.length === 0 ? '' : `:${framed.join(':')}`}`;
}
