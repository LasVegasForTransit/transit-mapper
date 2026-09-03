import { describe, expect, it } from 'vitest';
import { canonicalValueBytes } from '../../src/encoding/canonical-value';

function hex(value: unknown): string {
  return Array.from(canonicalValueBytes(value), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

describe('canonical value encoding', () => {
  it('uses the fixed scalar tags and binary representations', () => {
    expect(hex(null)).toBe('00');
    expect(hex(false)).toBe('01');
    expect(hex(true)).toBe('02');
    expect(hex(1)).toBe('033ff0000000000000');
    expect(hex(-0)).toBe(hex(0));
    expect(hex('A')).toBe('040000000141');
  });

  it('frames recursive array values without adding a top-level identity frame', () => {
    expect(hex([true, 'A'])).toBe('0500000002000000010200000006040000000141');
    expect(hex([false, true])).not.toBe(hex([true, false]));
  });

  it('sorts object fields by unsigned UTF-8 key bytes', () => {
    expect(hex({ z: false, a: true })).toBe('060000000200000001610000000102000000017a0000000101');

    const encoded = canonicalValueBytes({ '\u{10000}': false, '\uE000': true });
    const firstKeyLength = new DataView(encoded.buffer, encoded.byteOffset + 5, 4).getUint32(0);
    const firstKey = new TextDecoder().decode(encoded.subarray(9, 9 + firstKeyLength));

    expect(firstKey).toBe('\uE000');
  });

  it('encodes nested objects deterministically without normalizing text', () => {
    expect(hex({ route: ['é', 'e\u0301'] })).toBe(hex({ route: ['é', 'e\u0301'] }));
    expect(hex({ route: ['é'] })).not.toBe(hex({ route: ['e\u0301'] }));
    expect(hex({ b: 2, a: { enabled: true } })).toBe(hex({ a: { enabled: true }, b: 2 }));
  });

  it('rejects values that have no canonical representation', () => {
    const sparse = new Array(1);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const withAccessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 });
    const arrayWithProperty = [1] as number[] & { label?: string };
    arrayWithProperty.label = 'one';

    const invalidValues: readonly (readonly [name: string, value: unknown])[] = [
      ['NaN', Number.NaN],
      ['positive infinity', Number.POSITIVE_INFINITY],
      ['negative infinity', Number.NEGATIVE_INFINITY],
      ['undefined', undefined],
      ['an array containing undefined', [undefined]],
      ['a sparse array', sparse],
      ['a function', () => undefined],
      ['a symbol', Symbol('value')],
      ['a bigint', 1n],
      ['a Date', new Date(0)],
      [
        'a class instance',
        new (class Value {
          readonly marker = true;
        })(),
      ],
      ['an unpaired high surrogate', '\ud800'],
      ['an unpaired low surrogate', '\udc00'],
      ['an accessor property', withAccessor],
      ['an array with a named property', arrayWithProperty],
      ['a cyclic object', cyclic],
    ];

    for (const [name, value] of invalidValues) {
      expect(() => canonicalValueBytes(value), name).toThrow();
    }
  });
});
