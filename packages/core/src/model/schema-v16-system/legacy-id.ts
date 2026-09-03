import { derivedId, type DerivedIdPart } from '../derived-id';

type LegacyIdPart = DerivedIdPart;

/**
 * Preserves IDs that schema v16 never stored directly. The byte-length framing
 * keeps punctuation in old IDs from changing the generated identity.
 */
export function legacyDerivedId(kind: string, ...parts: LegacyIdPart[]): string {
  return derivedId('v16', kind, ...parts);
}
