import { describe, expect, it } from 'vitest';
import { prepareLineSpanCandidates } from '../../src/line/line-span-candidates';
import {
  aLineSpanChunk,
  aLineSpanProjection,
  aResolvedCarrier,
  aResolvedPatternLeg,
} from '../support/line-spans.test';

describe('Line span candidate validation', () => {
  it.each([
    {
      name: 'missing Alignment entity',
      entities: { alignments: [], ways: [] },
      carrier: aResolvedCarrier(),
      reason: 'missing-alignment',
      recordId: 'alignment',
    },
    {
      name: 'Alignment carrier with a different identity',
      entities: { alignments: [{ id: 'alignment' }], ways: [] },
      carrier: aResolvedCarrier({
        carrier: { kind: 'alignment', id: 'fabricated-alignment' },
      }),
      reason: 'carrier-alignment-conflict',
      recordId: 'fabricated-alignment',
    },
    {
      name: 'missing Way entity',
      entities: { alignments: [{ id: 'alignment' }], ways: [] },
      carrier: aResolvedCarrier({ carrier: { kind: 'way', id: 'missing-way', laneId: 'lane' } }),
      reason: 'missing-way',
      recordId: 'missing-way',
    },
    {
      name: 'Way assigned to another Alignment',
      entities: {
        alignments: [{ id: 'alignment' }],
        ways: [
          {
            id: 'way',
            alignmentId: 'other-alignment',
            alignmentExtent: [0, 1] as const,
            typeId: 'road',
            grade: 'atGrade' as const,
            profile: {
              lanes: [{ id: 'lane', kindId: 'bus', widthMeters: 3, direction: 'both' as const }],
            },
          },
        ],
      },
      carrier: aResolvedCarrier({ carrier: { kind: 'way', id: 'way', laneId: 'lane' } }),
      reason: 'carrier-alignment-conflict',
      recordId: 'way',
    },
    {
      name: 'Way lane that does not exist',
      entities: {
        alignments: [{ id: 'alignment' }],
        ways: [
          {
            id: 'way',
            alignmentId: 'alignment',
            alignmentExtent: [0, 1] as const,
            typeId: 'road',
            grade: 'atGrade' as const,
            profile: { lanes: [] },
          },
        ],
      },
      carrier: aResolvedCarrier({ carrier: { kind: 'way', id: 'way', laneId: 'missing-lane' } }),
      reason: 'missing-way-lane',
      recordId: 'missing-lane',
    },
    {
      name: 'Way with a zero-length Alignment extent',
      entities: {
        alignments: [{ id: 'alignment' }],
        ways: [
          {
            id: 'way',
            alignmentId: 'alignment',
            alignmentExtent: [0.5, 0.5] as const,
            typeId: 'road',
            grade: 'atGrade' as const,
            profile: {
              lanes: [{ id: 'lane', kindId: 'bus', widthMeters: 3, direction: 'both' as const }],
            },
          },
        ],
      },
      carrier: aResolvedCarrier({ carrier: { kind: 'way', id: 'way', laneId: 'lane' } }),
      reason: 'invalid-way-alignment-extent',
      recordId: 'way',
    },
  ])('rejects a $name before carrier grouping', ({ entities, carrier, reason, recordId }) => {
    const chunk = aLineSpanChunk();
    expect(
      prepareLineSpanCandidates(
        aLineSpanProjection({
          chunks: [
            {
              ...chunk,
              entities: { ...chunk.entities, ...entities },
              geometry: { ...chunk.geometry, carriers: [carrier] },
            },
          ],
        }),
      ),
    ).toEqual({ kind: 'rejected', reason, recordId });
  });

  it.each([
    { name: 'reversed', alignmentExtent: [0.75, 0.25] as const },
    { name: 'negative', alignmentExtent: [-0.1, 0.5] as const },
    { name: 'above-one', alignmentExtent: [0.5, 1.1] as const },
    { name: 'nonfinite', alignmentExtent: [0, Number.POSITIVE_INFINITY] as const },
  ])('rejects a $name Way Alignment extent before carrier grouping', ({ alignmentExtent }) => {
    const chunk = aLineSpanChunk();
    expect(
      prepareLineSpanCandidates(
        aLineSpanProjection({
          chunks: [
            {
              ...chunk,
              entities: {
                ...chunk.entities,
                ways: [
                  {
                    id: 'way',
                    alignmentId: 'alignment',
                    alignmentExtent,
                    typeId: 'road',
                    grade: 'atGrade',
                    profile: {
                      lanes: [{ id: 'lane', kindId: 'bus', widthMeters: 3, direction: 'both' }],
                    },
                  },
                ],
              },
              geometry: {
                ...chunk.geometry,
                carriers: [
                  aResolvedCarrier({ carrier: { kind: 'way', id: 'way', laneId: 'lane' } }),
                ],
              },
            },
          ],
        }),
      ),
    ).toEqual({
      kind: 'rejected',
      reason: 'invalid-way-alignment-extent',
      recordId: 'way',
    });
  });

  it('rejects a Pattern fragment whose Alignment range conflicts with its Way', () => {
    const chunk = aLineSpanChunk();
    expect(
      prepareLineSpanCandidates(
        aLineSpanProjection({
          chunks: [
            {
              ...chunk,
              entities: {
                ...chunk.entities,
                ways: [
                  {
                    id: 'way',
                    alignmentId: 'alignment',
                    alignmentExtent: [0.25, 0.75],
                    typeId: 'road',
                    grade: 'atGrade',
                    profile: {
                      lanes: [{ id: 'lane', kindId: 'bus', widthMeters: 3, direction: 'both' }],
                    },
                  },
                ],
              },
              geometry: {
                ...chunk.geometry,
                carriers: [
                  aResolvedCarrier({
                    carrier: { kind: 'way', id: 'way', laneId: 'lane' },
                  }),
                ],
              },
            },
          ],
        }),
      ),
    ).toEqual({
      kind: 'rejected',
      reason: 'way-alignment-range-conflict',
      recordId: 'logical-leg',
    });
  });

  it('validates a Way shard against the Way-owned global mapping', () => {
    const chunk = aLineSpanChunk();
    const carrier = aResolvedCarrier({
      carrier: { kind: 'way', id: 'way', laneId: 'lane' },
      alignmentRange: [0, 0.010000000000000002],
    });
    const fragment = aResolvedPatternLeg({
      carrierFragmentId: carrier.id,
      carrierRange: [0, 0.1],
      logicalCarrierRange: [0, 0.3],
      logicalAlignmentRange: [0, 0.03],
    });
    const result = prepareLineSpanCandidates(
      aLineSpanProjection({
        chunks: [
          {
            ...chunk,
            entities: {
              ...chunk.entities,
              ways: [
                {
                  id: 'way',
                  alignmentId: 'alignment',
                  alignmentExtent: [0, 0.1],
                  typeId: 'road',
                  grade: 'atGrade',
                  profile: {
                    lanes: [{ id: 'lane', kindId: 'bus', widthMeters: 3, direction: 'both' }],
                  },
                },
              ],
            },
            geometry: {
              carriers: [carrier],
              patternLegs: [fragment],
              visiblePatternLegFragmentIds: [fragment.id],
            },
          },
        ],
      }),
    );

    expect(result).toMatchObject({
      kind: 'ready',
      candidates: [
        {
          alignmentMapping: { kind: 'way-affine', alignmentExtent: [0, 0.1] },
          logicalCarrierRange: [0, 0.3],
        },
      ],
    });
  });

  it('rejects a Way shard that conflicts with the Way-owned global mapping', () => {
    const chunk = aLineSpanChunk();
    const carrier = aResolvedCarrier({
      carrier: { kind: 'way', id: 'way', laneId: 'lane' },
      alignmentRange: [0, 0.01],
    });
    const fragment = aResolvedPatternLeg({
      carrierFragmentId: carrier.id,
      carrierRange: [0, 0.1],
      logicalCarrierRange: [0, 0.3],
      logicalAlignmentRange: [0, 0.03],
    });

    expect(
      prepareLineSpanCandidates(
        aLineSpanProjection({
          chunks: [
            {
              ...chunk,
              entities: {
                ...chunk.entities,
                ways: [
                  {
                    id: 'way',
                    alignmentId: 'alignment',
                    alignmentExtent: [0, 0.1],
                    typeId: 'road',
                    grade: 'atGrade',
                    profile: {
                      lanes: [{ id: 'lane', kindId: 'bus', widthMeters: 3, direction: 'both' }],
                    },
                  },
                ],
              },
              geometry: {
                carriers: [carrier],
                patternLegs: [fragment],
                visiblePatternLegFragmentIds: [fragment.id],
              },
            },
          ],
        }),
      ),
    ).toEqual({
      kind: 'rejected',
      reason: 'way-alignment-shard-conflict',
      recordId: fragment.id,
    });
  });
});
