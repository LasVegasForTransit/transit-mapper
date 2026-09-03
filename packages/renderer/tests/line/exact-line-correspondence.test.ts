import { describe, expect, it } from 'vitest';
import type { TransitCarrierRef } from '@transitmapper/core/transit/value-types';
import { deriveExactLineCorrespondence } from '../../src/line/exact-line-correspondence';
import type { LineSpan } from '../../src/line/line-span-types';

interface SpanOptions {
  readonly id: string;
  readonly lineId: string;
  readonly carrier?: TransitCarrierRef;
  readonly range?: readonly [number, number];
  readonly direction?: 'forward' | 'reverse';
}

function aLineSpan(options: SpanOptions): LineSpan {
  const carrier = options.carrier ?? { kind: 'alignment', id: 'north-corridor' };
  const range = options.range ?? [0.2, 0.8];
  return {
    id: options.id,
    lineId: options.lineId,
    contributors: [
      {
        servicePlanId: `${options.lineId}-plan`,
        patternId: `${options.lineId}-pattern`,
        legIndex: 0,
        carrier,
        carrierRange: range,
        spanRange: options.direction === 'reverse' ? [1, 0] : [0, 1],
      },
    ],
    canonicalCarrier: carrier,
    canonicalCarrierRange: range,
  };
}

describe('exact Line correspondence', () => {
  it('identifies an exact shared carrier interval', () => {
    const local = aLineSpan({ id: 'local-span', lineId: 'local' });
    const express = aLineSpan({ id: 'express-span', lineId: 'express' });

    expect(
      deriveExactLineCorrespondence({
        lineOrder: [
          { lineId: 'local', rank: 0 },
          { lineId: 'express', rank: 1 },
        ],
        materializations: [
          { lineId: 'local', spans: [local] },
          { lineId: 'express', spans: [express] },
        ],
      }),
    ).toEqual({
      kind: 'ready',
      correspondences: [
        {
          canonicalCarrier: { kind: 'alignment', id: 'north-corridor' },
          canonicalCarrierRange: [0.2, 0.8],
          lineIds: ['local', 'express'],
          members: [local, express],
        },
      ],
    });
  });

  it('rejects a noncontiguous Line rank before deriving correspondence', () => {
    expect(
      deriveExactLineCorrespondence({
        lineOrder: [
          { lineId: 'local', rank: 0 },
          { lineId: 'express', rank: 2 },
        ],
        materializations: [
          { lineId: 'local', spans: [aLineSpan({ id: 'local-span', lineId: 'local' })] },
          { lineId: 'express', spans: [aLineSpan({ id: 'express-span', lineId: 'express' })] },
        ],
      }),
    ).toEqual({ kind: 'rejected', reason: 'invalid-line-order', recordId: 'express' });
  });

  it('rejects two Lines with the same rank before deriving correspondence', () => {
    expect(
      deriveExactLineCorrespondence({
        lineOrder: [
          { lineId: 'local', rank: 0 },
          { lineId: 'express', rank: 0 },
        ],
        materializations: [],
      }),
    ).toEqual({ kind: 'rejected', reason: 'invalid-line-order', recordId: 'express' });
  });

  it('rejects a materialized Line that has no dataset rank', () => {
    expect(
      deriveExactLineCorrespondence({
        lineOrder: [{ lineId: 'local', rank: 0 }],
        materializations: [
          { lineId: 'local', spans: [aLineSpan({ id: 'local-span', lineId: 'local' })] },
          { lineId: 'express', spans: [aLineSpan({ id: 'express-span', lineId: 'express' })] },
        ],
      }),
    ).toEqual({ kind: 'rejected', reason: 'missing-line-order', recordId: 'express' });
  });

  it('rejects a ranked Line without a materialization wrapper', () => {
    expect(
      deriveExactLineCorrespondence({
        lineOrder: [
          { lineId: 'local', rank: 0 },
          { lineId: 'express', rank: 1 },
          { lineId: 'empty', rank: 2 },
        ],
        materializations: [
          { lineId: 'local', spans: [aLineSpan({ id: 'local-span', lineId: 'local' })] },
          { lineId: 'express', spans: [aLineSpan({ id: 'express-span', lineId: 'express' })] },
        ],
      }),
    ).toEqual({ kind: 'rejected', reason: 'missing-line-materialization', recordId: 'empty' });
  });

  it('accepts an explicit empty wrapper for a ranked Line', () => {
    const local = aLineSpan({ id: 'local-span', lineId: 'local' });
    const express = aLineSpan({ id: 'express-span', lineId: 'express' });

    expect(
      deriveExactLineCorrespondence({
        lineOrder: [
          { lineId: 'local', rank: 0 },
          { lineId: 'express', rank: 1 },
          { lineId: 'empty', rank: 2 },
        ],
        materializations: [
          { lineId: 'local', spans: [local] },
          { lineId: 'express', spans: [express] },
          { lineId: 'empty', spans: [] },
        ],
      }),
    ).toEqual({
      kind: 'ready',
      correspondences: [
        {
          canonicalCarrier: { kind: 'alignment', id: 'north-corridor' },
          canonicalCarrierRange: [0.2, 0.8],
          lineIds: ['local', 'express'],
          members: [local, express],
        },
      ],
    });
  });

  it('keeps a branch correspondence within the shared carrier interval', () => {
    const trunk = aLineSpan({ id: 'trunk-span', lineId: 'trunk', range: [0, 1] });
    const branch = aLineSpan({ id: 'branch-span', lineId: 'branch', range: [0.35, 0.65] });

    const result = deriveExactLineCorrespondence({
      lineOrder: [
        { lineId: 'trunk', rank: 0 },
        { lineId: 'branch', rank: 1 },
      ],
      materializations: [
        { lineId: 'trunk', spans: [trunk] },
        { lineId: 'branch', spans: [branch] },
      ],
    });

    expect(result).toEqual({
      kind: 'ready',
      correspondences: [
        {
          canonicalCarrier: { kind: 'alignment', id: 'north-corridor' },
          canonicalCarrierRange: [0.35, 0.65],
          lineIds: ['trunk', 'branch'],
          members: [trunk, branch],
        },
      ],
    });
  });

  it('treats reversed contributor travel as the same canonical interval', () => {
    const northbound = aLineSpan({ id: 'northbound-span', lineId: 'northbound' });
    const southbound = aLineSpan({
      id: 'southbound-span',
      lineId: 'southbound',
      direction: 'reverse',
    });

    const result = deriveExactLineCorrespondence({
      lineOrder: [
        { lineId: 'northbound', rank: 0 },
        { lineId: 'southbound', rank: 1 },
      ],
      materializations: [
        { lineId: 'northbound', spans: [northbound] },
        { lineId: 'southbound', spans: [southbound] },
      ],
    });

    expect(result).toEqual({
      kind: 'ready',
      correspondences: [
        {
          canonicalCarrier: { kind: 'alignment', id: 'north-corridor' },
          canonicalCarrierRange: [0.2, 0.8],
          lineIds: ['northbound', 'southbound'],
          members: [northbound, southbound],
        },
      ],
    });
  });

  it('orders member Lines and spans by rank when materializations arrive out of order', () => {
    const localA = aLineSpan({ id: 'local-a', lineId: 'local' });
    const localZ = aLineSpan({ id: 'local-z', lineId: 'local' });
    const express = aLineSpan({ id: 'express-span', lineId: 'express' });

    const result = deriveExactLineCorrespondence({
      lineOrder: [
        { lineId: 'local', rank: 0 },
        { lineId: 'express', rank: 1 },
      ],
      materializations: [
        { lineId: 'express', spans: [express] },
        { lineId: 'local', spans: [localZ, localA] },
      ],
    });

    expect(result).toMatchObject({
      kind: 'ready',
      correspondences: [
        {
          lineIds: ['local', 'express'],
          members: [localA, localZ, express],
        },
      ],
    });
  });

  it('orders carrier correspondences independently of materialization arrival', () => {
    const alphaCarrier: TransitCarrierRef = { kind: 'alignment', id: 'alpha-corridor' };
    const zuluCarrier: TransitCarrierRef = { kind: 'alignment', id: 'zulu-corridor' };
    const alphaLocal = aLineSpan({
      id: 'alpha-local-span',
      lineId: 'alpha-local',
      carrier: alphaCarrier,
    });
    const alphaExpress = aLineSpan({
      id: 'alpha-express-span',
      lineId: 'alpha-express',
      carrier: alphaCarrier,
    });
    const zuluLocal = aLineSpan({
      id: 'zulu-local-span',
      lineId: 'zulu-local',
      carrier: zuluCarrier,
    });
    const zuluExpress = aLineSpan({
      id: 'zulu-express-span',
      lineId: 'zulu-express',
      carrier: zuluCarrier,
    });

    expect(
      deriveExactLineCorrespondence({
        lineOrder: [
          { lineId: 'alpha-local', rank: 0 },
          { lineId: 'alpha-express', rank: 1 },
          { lineId: 'zulu-local', rank: 2 },
          { lineId: 'zulu-express', rank: 3 },
        ],
        materializations: [
          { lineId: 'zulu-express', spans: [zuluExpress] },
          { lineId: 'zulu-local', spans: [zuluLocal] },
          { lineId: 'alpha-express', spans: [alphaExpress] },
          { lineId: 'alpha-local', spans: [alphaLocal] },
        ],
      }),
    ).toEqual({
      kind: 'ready',
      correspondences: [
        {
          canonicalCarrier: alphaCarrier,
          canonicalCarrierRange: [0.2, 0.8],
          lineIds: ['alpha-local', 'alpha-express'],
          members: [alphaLocal, alphaExpress],
        },
        {
          canonicalCarrier: zuluCarrier,
          canonicalCarrierRange: [0.2, 0.8],
          lineIds: ['zulu-local', 'zulu-express'],
          members: [zuluLocal, zuluExpress],
        },
      ],
    });
  });

  it('rejects a span that belongs to a different materialized Line', () => {
    expect(
      deriveExactLineCorrespondence({
        lineOrder: [
          { lineId: 'local', rank: 0 },
          { lineId: 'express', rank: 1 },
        ],
        materializations: [
          {
            lineId: 'local',
            spans: [aLineSpan({ id: 'express-span', lineId: 'express' })],
          },
          { lineId: 'express', spans: [] },
        ],
      }),
    ).toEqual({ kind: 'rejected', reason: 'line-scope-conflict', recordId: 'express-span' });
  });

  it.each([
    [Number.NaN, 0.8],
    [0.2, Number.POSITIVE_INFINITY],
    [-0.1, 0.8],
    [0.2, 1.1],
    [0.6, 0.6],
    [0.8, 0.2],
  ])('rejects an invalid canonical carrier range %o', (start, end) => {
    expect(
      deriveExactLineCorrespondence({
        lineOrder: [{ lineId: 'local', rank: 0 }],
        materializations: [
          {
            lineId: 'local',
            spans: [aLineSpan({ id: 'local-span', lineId: 'local', range: [start, end] })],
          },
        ],
      }),
    ).toEqual({
      kind: 'rejected',
      reason: 'invalid-canonical-carrier-range',
      recordId: 'local-span',
    });
  });

  it('rejects duplicate materialization wrappers for one Line', () => {
    expect(
      deriveExactLineCorrespondence({
        lineOrder: [{ lineId: 'local', rank: 0 }],
        materializations: [
          { lineId: 'local', spans: [] },
          { lineId: 'local', spans: [] },
        ],
      }),
    ).toEqual({ kind: 'rejected', reason: 'duplicate-line-materialization', recordId: 'local' });
  });

  it('does not merge spans on different canonical carriers', () => {
    const local = aLineSpan({ id: 'local-span', lineId: 'local' });
    const express = aLineSpan({
      id: 'express-span',
      lineId: 'express',
      carrier: { kind: 'alignment', id: 'nearby-corridor' },
    });

    expect(
      deriveExactLineCorrespondence({
        lineOrder: [
          { lineId: 'local', rank: 0 },
          { lineId: 'express', rank: 1 },
        ],
        materializations: [
          { lineId: 'local', spans: [local] },
          { lineId: 'express', spans: [express] },
        ],
      }),
    ).toEqual({ kind: 'ready', correspondences: [] });
  });

  it('does not treat two spans from one Line as shared correspondence', () => {
    const first = aLineSpan({ id: 'local-a', lineId: 'local' });
    const second = aLineSpan({ id: 'local-b', lineId: 'local' });

    expect(
      deriveExactLineCorrespondence({
        lineOrder: [{ lineId: 'local', rank: 0 }],
        materializations: [{ lineId: 'local', spans: [first, second] }],
      }),
    ).toEqual({ kind: 'ready', correspondences: [] });
  });
});
