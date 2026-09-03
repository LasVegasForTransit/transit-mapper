import { describe, expect, it } from 'vitest';
import { frame } from '../../src/encoding/frame';

describe('identity framing', () => {
  it('prefixes the part count and each exact byte length in big-endian order', () => {
    expect(Array.from(frame(['a', 'bc']))).toEqual([
      0, 0, 0, 2, 0, 0, 0, 1, 97, 0, 0, 0, 2, 98, 99,
    ]);
  });

  it('frames nested bytes without interpreting them as text', () => {
    expect(Array.from(frame([Uint8Array.of(0, 255)]))).toEqual([0, 0, 0, 1, 0, 0, 0, 2, 0, 255]);
  });

  it('rejects text that cannot be encoded as strict UTF-8', () => {
    expect(() => frame(['\ud800'])).toThrow();
  });
});
