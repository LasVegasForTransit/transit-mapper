import { describe, expect, it } from 'vitest';
import {
  decodeMapViewState,
  encodeMapViewState,
  MAX_TRANSIENT_VIEW_FRAGMENT_BYTES,
  ViewParseError,
} from '../src/index';

const STATE = {
  schemaVersion: 1,
  camera: { center: [-115.1728, 36.1147] as [number, number], zoom: 11 },
  representationId: 'network',
  filters: { landmarks: true, modes: ['bus', 'rail'] },
  selection: { source: 'document', kind: 'station', id: 'estación-1' },
} as const;

describe('transient View fragments', () => {
  it('round-trips portable View state through base64url without padding', () => {
    const encoded = encodeMapViewState(STATE);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain('=');
    expect(decodeMapViewState(encoded)).toEqual(STATE);
  });

  it('rejects a URL-decoded fragment above 8 KiB before base64 parsing', () => {
    expect(() => decodeMapViewState('a'.repeat(MAX_TRANSIENT_VIEW_FRAGMENT_BYTES + 1))).toThrow(
      '8 KiB',
    );
  });

  it('refuses to encode View state that cannot fit in one transient fragment', () => {
    const filters = Object.fromEntries(
      Array.from({ length: 32 }, (_, filterIndex) => [
        `filter-${filterIndex}`,
        Array.from({ length: 64 }, (_, valueIndex) => `value-${filterIndex}-${valueIndex}`),
      ]),
    );

    expect(() => encodeMapViewState({ ...STATE, filters })).toThrow('8 KiB');
  });

  it('rejects malformed base64url as an invalid View fragment', () => {
    expect(() => decodeMapViewState('not+base64')).toThrow(ViewParseError);
  });
});
