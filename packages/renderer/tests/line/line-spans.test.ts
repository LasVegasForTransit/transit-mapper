import type { ResolvedNetworkChunk } from '@transitmapper/core/network/resolved-network-chunk';
import { describe, expect, it } from 'vitest';
import { prepareLineSpanInput } from '../../src/line/line-spans';
import {
  aLineSpanChunk,
  aResolvedCarrier,
  aResolvedPatternLeg,
  anEmptyResolvedChunk,
} from '../support/line-spans.test';

function geometryChunk(
  id: string,
  carriers = [aResolvedCarrier()],
  patternLegs = [aResolvedPatternLeg()],
  visiblePatternLegFragmentIds = patternLegs.map(({ id: fragmentId }) => fragmentId),
): ResolvedNetworkChunk {
  const chunk = anEmptyResolvedChunk(id);
  return {
    ...chunk,
    geometry: { carriers, patternLegs, visiblePatternLegFragmentIds },
  };
}

function preparedInput(chunks: readonly ResolvedNetworkChunk[]) {
  const result = prepareLineSpanInput(chunks);
  expect(result.kind).toBe('ready');
  if (result.kind !== 'ready') throw new Error('Expected prepared Line span input.');
  return result.input;
}

describe('Line span input preparation', () => {
  it('keeps every transferred shard under one logical Pattern leg', () => {
    const firstCarrier = aResolvedCarrier({
      id: 'carrier-west',
      alignmentRange: [0.1, 0.3],
    });
    const secondCarrier = aResolvedCarrier({
      id: 'carrier-east',
      alignmentRange: [0.7, 0.9],
    });
    const topologyCarrier = aResolvedCarrier({
      id: 'carrier-middle',
      alignmentRange: [0.4, 0.6],
    });
    const firstLeg = aResolvedPatternLeg({
      id: 'leg-west',
      carrierFragmentId: firstCarrier.id,
      carrierRange: [0.1, 0.3],
    });
    const secondLeg = aResolvedPatternLeg({
      id: 'leg-east',
      carrierFragmentId: secondCarrier.id,
      carrierRange: [0.7, 0.9],
    });
    const topologyLeg = aResolvedPatternLeg({
      id: 'leg-middle',
      carrierFragmentId: topologyCarrier.id,
      carrierRange: [0.4, 0.6],
    });
    const input = preparedInput([
      geometryChunk(
        'geometry',
        [firstCarrier, secondCarrier, topologyCarrier],
        [firstLeg, secondLeg, topologyLeg],
        [firstLeg.id, secondLeg.id],
      ),
    ]);

    expect(new Set(input.shardsById.keys())).toEqual(
      new Set(['leg-east', 'leg-middle', 'leg-west']),
    );
    expect(input.logicalPatternLegsById.get('logical-leg')).toMatchObject({
      id: 'logical-leg',
      patternId: 'pattern',
      legIndex: 0,
      logicalCarrierRange: [0, 1],
      logicalAlignmentRange: [0, 1],
      shards: [
        { fragment: { id: 'leg-west' }, visible: true },
        { fragment: { id: 'leg-middle' }, visible: false },
        { fragment: { id: 'leg-east' }, visible: true },
      ],
    });
  });

  it('deduplicates byte-equal transfer records independent of chunk order', () => {
    const facts = aLineSpanChunk();
    const duplicate = geometryChunk('duplicate');
    const forward = prepareLineSpanInput([facts, duplicate]);
    const reverse = prepareLineSpanInput([duplicate, facts]);

    expect(forward).toEqual(reverse);
    expect(forward).toMatchObject({
      kind: 'ready',
      input: {
        logicalPatternLegsById: new Map([
          ['logical-leg', { shards: [{ fragment: { id: 'leg-shard' }, visible: true }] }],
        ]),
      },
    });
  });

  it.each([
    {
      name: 'carrier fragment',
      duplicate: geometryChunk('duplicate-carrier', [
        aResolvedCarrier({
          points: [
            [-0.5, 0],
            [0.6, 0],
          ],
        }),
      ]),
      reason: 'mismatched-carrier-fragment',
      recordId: 'carrier-shard',
    },
    {
      name: 'Pattern leg shard',
      duplicate: geometryChunk(
        'duplicate-leg',
        [],
        [aResolvedPatternLeg({ carrierRange: [0.2, 0.75] })],
      ),
      reason: 'mismatched-pattern-leg-fragment',
      recordId: 'leg-shard',
    },
  ])('rejects a changed $name that reuses a transferred ID', ({ duplicate, reason, recordId }) => {
    expect(prepareLineSpanInput([aLineSpanChunk(), duplicate])).toEqual({
      kind: 'rejected',
      reason,
      recordId,
    });
  });

  it.each([
    {
      name: 'carrier fragment',
      chunk: geometryChunk('invalid-carrier', [
        aResolvedCarrier({
          points: [
            [Number.NaN, 0],
            [0.6, 0],
          ],
        }),
      ]),
      reason: 'noncanonical-carrier-fragment',
      recordId: 'carrier-shard',
    },
    {
      name: 'Pattern leg shard',
      chunk: geometryChunk(
        'invalid-pattern-leg',
        [aResolvedCarrier()],
        [aResolvedPatternLeg({ patternId: '\ud800' })],
      ),
      reason: 'noncanonical-pattern-leg-fragment',
      recordId: 'leg-shard',
    },
  ])('rejects one noncanonical $name', ({ chunk, reason, recordId }) => {
    expect(prepareLineSpanInput([chunk])).toEqual({ kind: 'rejected', reason, recordId });
  });

  it('ignores carrier geometry that no Pattern leg references', () => {
    const chunk = aLineSpanChunk();
    expect(
      prepareLineSpanInput([
        {
          ...chunk,
          geometry: {
            ...chunk.geometry,
            carriers: [
              ...chunk.geometry.carriers,
              aResolvedCarrier({
                id: 'unreferenced-carrier',
                points: [
                  [Number.NaN, 0],
                  [0.6, 0],
                ],
              }),
            ],
          },
        },
      ]),
    ).toMatchObject({ kind: 'ready' });
  });

  it.each([
    ['Pattern', { patternId: 'other-pattern' }],
    ['leg occurrence', { legIndex: 1 }],
    ['direction', { direction: 'reverse' as const }],
    [
      'logical ranges',
      {
        logicalCarrierRange: [0, 0.9] as const,
        logicalAlignmentRange: [0, 0.9] as const,
      },
    ],
  ])('rejects one logical ID that names a different %s', (_name, overrides) => {
    const conflictingCarrier = aResolvedCarrier({
      id: 'carrier-conflict',
      alignmentRange: [0.75, 0.9],
    });
    const conflictingLeg = aResolvedPatternLeg({
      id: 'leg-conflict',
      carrierFragmentId: conflictingCarrier.id,
      carrierRange: [0.75, 0.9],
      ...overrides,
    });

    expect(
      prepareLineSpanInput([
        aLineSpanChunk(),
        geometryChunk('conflict', [conflictingCarrier], [conflictingLeg]),
      ]),
    ).toEqual({
      kind: 'rejected',
      reason: 'logical-pattern-leg-conflict',
      recordId: 'logical-leg',
    });
  });

  it.each([
    {
      name: 'semantic carrier',
      carrier: { kind: 'alignment' as const, id: 'other-alignment' },
      alignmentId: 'alignment',
    },
    {
      name: 'Alignment',
      carrier: { kind: 'alignment' as const, id: 'alignment' },
      alignmentId: 'other-alignment',
    },
  ])('rejects one logical ID that names a different $name', ({ carrier, alignmentId }) => {
    const otherCarrier = aResolvedCarrier({
      id: 'other-carrier-shard',
      carrier,
      alignmentId,
      alignmentRange: [0.75, 0.9],
    });
    const otherLeg = aResolvedPatternLeg({
      id: 'other-leg-shard',
      carrierFragmentId: otherCarrier.id,
      carrierRange: [0.75, 0.9],
    });

    expect(
      prepareLineSpanInput([aLineSpanChunk(), geometryChunk('other', [otherCarrier], [otherLeg])]),
    ).toEqual({
      kind: 'rejected',
      reason: 'logical-pattern-leg-conflict',
      recordId: 'logical-leg',
    });
  });

  it.each([
    ['nonfinite', [0.2, 0.8] as const, [0, Number.NaN] as const, 'invalid-logical-range'],
    ['reversed', [0.8, 0.2] as const, [0, 1] as const, 'invalid-shard-range'],
    ['zero length', [0.5, 0.5] as const, [0, 1] as const, 'invalid-shard-range'],
    ['outside', [0.1, 0.9] as const, [0.2, 0.8] as const, 'shard-outside-logical-range'],
  ])('rejects a %s normalized range', (_name, carrierRange, logicalCarrierRange, reason) => {
    const fragment = aResolvedPatternLeg({ carrierRange, logicalCarrierRange });
    const chunk = aLineSpanChunk();

    expect(
      prepareLineSpanInput([
        {
          ...chunk,
          geometry: {
            ...chunk.geometry,
            patternLegs: [fragment],
          },
        },
      ]),
    ).toEqual({ kind: 'rejected', reason, recordId: fragment.id });
  });

  it.each([
    {
      name: 'nonfinite logical Alignment range',
      carrier: aResolvedCarrier(),
      fragment: aResolvedPatternLeg({ logicalAlignmentRange: [0, Number.NaN] }),
      reason: 'invalid-logical-alignment-range',
    },
    {
      name: 'reversed Alignment shard range',
      carrier: aResolvedCarrier({ alignmentRange: [0.8, 0.2] }),
      fragment: aResolvedPatternLeg(),
      reason: 'invalid-alignment-shard-range',
    },
    {
      name: 'Alignment shard outside its logical range',
      carrier: aResolvedCarrier({ alignmentRange: [0.1, 0.9] }),
      fragment: aResolvedPatternLeg({ logicalAlignmentRange: [0.2, 0.8] }),
      reason: 'alignment-shard-outside-logical-range',
    },
    {
      name: 'Alignment carrier with different shard parameterizations',
      carrier: aResolvedCarrier({ alignmentRange: [0.2, 0.8] }),
      fragment: aResolvedPatternLeg({ carrierRange: [0.25, 0.75] }),
      reason: 'alignment-carrier-range-conflict',
    },
    {
      name: 'Alignment carrier with different logical parameterizations',
      carrier: aResolvedCarrier(),
      fragment: aResolvedPatternLeg({ logicalAlignmentRange: [0.1, 0.9] }),
      reason: 'alignment-carrier-range-conflict',
    },
  ])('rejects a $name', ({ carrier, fragment, reason }) => {
    const chunk = geometryChunk('invalid-alignment-range', [carrier], [fragment]);
    expect(prepareLineSpanInput([chunk])).toEqual({
      kind: 'rejected',
      reason,
      recordId: fragment.id,
    });
  });

  it('keeps distinct carrier and Alignment parameterizations for a Way', () => {
    const carrier = aResolvedCarrier({
      carrier: { kind: 'way', id: 'way', laneId: 'lane' },
      alignmentRange: [0.4, 0.6],
    });
    const fragment = aResolvedPatternLeg({
      carrierRange: [0.3, 0.7],
      logicalCarrierRange: [0, 1],
      logicalAlignmentRange: [0.25, 0.75],
    });

    expect(
      prepareLineSpanInput([geometryChunk('way-parameterization', [carrier], [fragment])]),
    ).toMatchObject({
      kind: 'ready',
      input: {
        logicalPatternLegsById: new Map([
          [
            'logical-leg',
            {
              logicalCarrierRange: [0, 1],
              logicalAlignmentRange: [0.25, 0.75],
            },
          ],
        ]),
      },
    });
  });

  it('rejects one Way logical ID with a different logical Alignment range', () => {
    const firstCarrier = aResolvedCarrier({
      carrier: { kind: 'way', id: 'way', laneId: 'lane' },
      alignmentRange: [0.25, 0.5],
    });
    const secondCarrier = aResolvedCarrier({
      id: 'carrier-second',
      carrier: { kind: 'way', id: 'way', laneId: 'lane' },
      alignmentRange: [0.5, 0.6875],
    });
    const firstLeg = aResolvedPatternLeg({
      carrierRange: [0.25, 0.5],
      logicalAlignmentRange: [0, 1],
    });
    const secondLeg = aResolvedPatternLeg({
      id: 'leg-second',
      carrierFragmentId: secondCarrier.id,
      carrierRange: [0.5, 0.75],
      logicalAlignmentRange: [0.125, 0.875],
    });

    expect(
      prepareLineSpanInput([
        geometryChunk('first', [firstCarrier], [firstLeg]),
        geometryChunk('second', [secondCarrier], [secondLeg]),
      ]),
    ).toEqual({
      kind: 'rejected',
      reason: 'logical-pattern-leg-conflict',
      recordId: 'logical-leg',
    });
  });

  it('rejects a visible shard that the transfer did not include', () => {
    const chunk = geometryChunk('missing-visible', [], [], ['later-shard']);
    expect(prepareLineSpanInput([chunk])).toEqual({
      kind: 'rejected',
      reason: 'missing-visible-pattern-leg-fragment',
      recordId: 'later-shard',
    });
  });

  it('rejects a transferred shard without its carrier geometry', () => {
    const chunk = geometryChunk('missing-carrier', [], [aResolvedPatternLeg()]);
    expect(prepareLineSpanInput([chunk])).toEqual({
      kind: 'rejected',
      reason: 'missing-carrier-fragment',
      recordId: 'carrier-shard',
    });
  });

  it('does not reject a topology fragment that a later page may supply', () => {
    const chunk = aLineSpanChunk();
    expect(
      prepareLineSpanInput([
        {
          ...chunk,
          relationships: {
            ...chunk.relationships,
            topologyWindows: [
              {
                id: 'window',
                patternId: 'pattern',
                anchoredCalls: [
                  { stopCallId: 'start', patternLegBoundaryIndex: 0 },
                  { stopCallId: 'end', patternLegBoundaryIndex: 2 },
                ],
                patternLegFragmentIds: ['leg-shard', 'later-shard'],
              },
            ],
          },
        },
      ]),
    ).toMatchObject({ kind: 'ready' });
  });
});
