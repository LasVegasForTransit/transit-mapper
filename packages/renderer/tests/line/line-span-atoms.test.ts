import { describe, expect, it } from 'vitest';
import { prepareLineSpanCandidates } from '../../src/line/line-span-candidates';
import {
  aLineSpanChunk,
  aLineSpanProjection,
  aResolvedCarrier,
  aResolvedPatternLeg,
} from '../support/line-spans.test';
import {
  aLineSpanCandidate as aCandidate,
  deriveExactCarrierLineSpanAtoms,
  readyLineSpanAtoms as readyAtoms,
  readyLineSpanDerivation as readyDerivation,
} from '../support/line-span-atoms.test';

describe('exact-carrier Line span atoms', () => {
  it('uses a shared Alignment as the passenger carrier across authored and physical paths', () => {
    const atoms = readyAtoms(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [
          aCandidate({
            patternId: 'alignment-pattern',
            logicalCarrierRange: [0.2, 0.8],
          }),
          aCandidate({
            servicePlanId: 'physical-plan',
            patternId: 'physical-pattern',
            logicalPatternLegFragmentId: 'physical-leg',
            carrier: { kind: 'way', id: 'way', laneId: 'lane' },
            logicalCarrierRange: [0, 1],
            alignmentMapping: { kind: 'way-affine', alignmentExtent: [0.2, 0.8] },
          }),
        ],
      }),
    );

    expect(atoms).toHaveLength(1);
    expect(atoms[0]).toMatchObject({
      lineId: 'line',
      canonicalCarrier: { kind: 'alignment', id: 'alignment' },
      canonicalCarrierRange: [0.2, 0.8],
      contributors: [
        { patternId: 'physical-pattern', carrierRange: [0, 1] },
        { patternId: 'alignment-pattern', carrierRange: [0.2, 0.8] },
      ],
    });
  });

  it('uses the Way-owned nonidentity Alignment extent through candidate preparation', () => {
    const chunk = aLineSpanChunk();
    const alignmentCarrier = aResolvedCarrier({
      id: 'alignment-carrier',
      alignmentRange: [0.4, 0.6],
    });
    const alignmentLeg = aResolvedPatternLeg({
      id: 'alignment-leg',
      logicalPatternLegFragmentId: 'alignment-logical-leg',
      carrierFragmentId: alignmentCarrier.id,
      carrierRange: [0.4, 0.6],
      logicalCarrierRange: [0.4, 0.6],
      logicalAlignmentRange: [0.4, 0.6],
    });
    const wayCarrier = aResolvedCarrier({
      id: 'way-carrier',
      carrier: { kind: 'way', id: 'way', laneId: 'lane' },
      alignmentRange: [0.2, 0.9],
    });
    const wayLeg = aResolvedPatternLeg({
      id: 'way-leg',
      logicalPatternLegFragmentId: 'way-logical-leg',
      patternId: 'way-pattern',
      carrierFragmentId: wayCarrier.id,
      carrierRange: [0, 1],
      logicalCarrierRange: [0, 1],
      logicalAlignmentRange: [0.2, 0.9],
    });
    const prepared = prepareLineSpanCandidates(
      aLineSpanProjection({
        chunks: [
          {
            ...chunk,
            entities: {
              ...chunk.entities,
              patterns: [...chunk.entities.patterns, { id: 'way-pattern', path: 'known' }],
              ways: [
                {
                  id: 'way',
                  alignmentId: 'alignment',
                  alignmentExtent: [0.2, 0.9],
                  typeId: 'road',
                  grade: 'atGrade',
                  profile: {
                    lanes: [{ id: 'lane', kindId: 'bus', widthMeters: 3, direction: 'both' }],
                  },
                },
              ],
            },
            relationships: {
              ...chunk.relationships,
              servicePlanPatterns: [
                ...chunk.relationships.servicePlanPatterns,
                { id: 'plan-way', servicePlanId: 'plan', patternId: 'way-pattern' },
              ],
            },
            geometry: {
              carriers: [alignmentCarrier, wayCarrier],
              patternLegs: [alignmentLeg, wayLeg],
              visiblePatternLegFragmentIds: [alignmentLeg.id, wayLeg.id],
            },
          },
        ],
      }),
    );
    expect(prepared.kind).toBe('ready');
    if (prepared.kind !== 'ready') throw new Error('Expected prepared Line candidates.');

    const atoms = readyAtoms(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: prepared.candidates,
      }),
    );
    const overlap = atoms.find(
      ({ canonicalCarrierRange }) =>
        canonicalCarrierRange[0] === 0.4 && canonicalCarrierRange[1] === 0.6,
    );

    expect(overlap?.contributors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patternId: 'way-pattern',
          carrierRange: [0.28571428571428575, 0.5714285714285714],
        }),
        expect.objectContaining({ patternId: 'pattern', carrierRange: [0.4, 0.6] }),
      ]),
    );
  });

  it('preserves exact Way carrier endpoints after Alignment projection', () => {
    const chunk = aLineSpanChunk();
    const carrier = aResolvedCarrier({
      carrier: { kind: 'way', id: 'way', laneId: 'lane' },
      alignmentRange: [0.27, 0.55],
    });
    const leg = aResolvedPatternLeg({
      carrierFragmentId: carrier.id,
      carrierRange: [0.1, 0.5],
      logicalCarrierRange: [0.1, 0.5],
      logicalAlignmentRange: [0.27, 0.55],
    });
    const prepared = prepareLineSpanCandidates(
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
                  alignmentExtent: [0.2, 0.9],
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
              patternLegs: [leg],
              visiblePatternLegFragmentIds: [leg.id],
            },
          },
        ],
      }),
    );
    expect(prepared.kind).toBe('ready');
    if (prepared.kind !== 'ready') throw new Error('Expected prepared Line candidates.');

    const atoms = readyAtoms(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: prepared.candidates,
      }),
    );

    expect(atoms).toMatchObject([
      {
        canonicalCarrierRange: [0.27, 0.55],
        contributors: [{ carrierRange: [0.1, 0.5] }],
      },
    ]);
  });

  it('consolidates only exact resolved Way lanes in Infrastructure', () => {
    const result = readyDerivation(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'same-physical-carrier',
        candidates: [
          aCandidate({
            patternId: 'shared-a',
            carrier: { kind: 'way', id: 'way-a', laneId: 'lane-1' },
          }),
          aCandidate({
            servicePlanId: 'shared-plan-b',
            patternId: 'shared-b',
            logicalPatternLegFragmentId: 'shared-leg-b',
            carrier: { kind: 'way', id: 'way-a', laneId: 'lane-1' },
          }),
          aCandidate({
            patternId: 'other-lane',
            logicalPatternLegFragmentId: 'other-lane-leg',
            carrier: { kind: 'way', id: 'way-a', laneId: 'lane-2' },
          }),
          aCandidate({
            patternId: 'other-way',
            logicalPatternLegFragmentId: 'other-way-leg',
            carrier: { kind: 'way', id: 'way-b', laneId: 'lane-1' },
          }),
          aCandidate({
            patternId: 'unresolved-lane',
            logicalPatternLegFragmentId: 'unresolved-lane-leg',
            carrier: { kind: 'way', id: 'way-a' },
          }),
          aCandidate({
            patternId: 'bare-a',
            logicalPatternLegFragmentId: 'bare-a-leg',
          }),
          aCandidate({
            patternId: 'bare-b',
            logicalPatternLegFragmentId: 'bare-b-leg',
          }),
        ],
      }),
    );

    const { atoms } = result;
    const contributorGroups = atoms.map((atom) =>
      atom.contributors.map(({ patternId }) => patternId).sort(),
    );
    expect(contributorGroups).toHaveLength(3);
    expect(contributorGroups).toEqual(
      expect.arrayContaining([['shared-a', 'shared-b'], ['other-lane'], ['other-way']]),
    );
    expect(result.deferred.map(({ reason, patternId }) => ({ reason, patternId }))).toEqual([
      { reason: 'bare-alignment', patternId: 'bare-a' },
      { reason: 'bare-alignment', patternId: 'bare-b' },
      { reason: 'unresolved-lane', patternId: 'unresolved-lane' },
    ]);
  });

  it('splits a carrier at every contributor boundary', () => {
    const atoms = readyAtoms(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [
          aCandidate({
            patternId: 'whole',
            carrier: { kind: 'way', id: 'whole-way', laneId: 'lane' },
          }),
          aCandidate({
            servicePlanId: 'short-plan',
            patternId: 'short',
            logicalPatternLegFragmentId: 'short-leg',
            carrier: { kind: 'way', id: 'short-way', laneId: 'lane' },
            logicalCarrierRange: [0, 1],
            alignmentMapping: { kind: 'way-affine', alignmentExtent: [0.25, 0.75] },
          }),
        ],
      }),
    );

    expect(
      atoms.map(({ canonicalCarrierRange, contributors }) => ({
        range: canonicalCarrierRange,
        patterns: contributors.map(({ patternId }) => patternId),
      })),
    ).toEqual([
      { range: [0, 0.25], patterns: ['whole'] },
      { range: [0.25, 0.75], patterns: ['whole', 'short'] },
      { range: [0.75, 1], patterns: ['whole'] },
    ]);
  });

  it('keeps opposite travel directions in one atom with opposite span ranges', () => {
    const atoms = readyAtoms(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [
          aCandidate({ patternId: 'forward' }),
          aCandidate({
            servicePlanId: 'reverse-plan',
            patternId: 'reverse',
            logicalPatternLegFragmentId: 'reverse-leg',
            direction: 'reverse',
          }),
        ],
      }),
    );

    expect(atoms).toHaveLength(1);
    expect(
      atoms[0]?.contributors.map(({ patternId, spanRange }) => ({ patternId, spanRange })),
    ).toEqual([
      { patternId: 'forward', spanRange: [0, 1] },
      { patternId: 'reverse', spanRange: [1, 0] },
    ]);
  });

  it('keeps the Line identity preimage stable across schedule and temporary variants', () => {
    const base = readyAtoms(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [aCandidate()],
      }),
    );
    const variants = readyAtoms(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [
          aCandidate({ lineRank: 7 }),
          aCandidate({
            lineRank: 7,
            servicePlanId: 'weekend-plan',
          }),
          aCandidate({
            lineRank: 7,
            servicePlanId: 'temporary-plan',
            patternId: 'temporary-pattern',
            logicalPatternLegFragmentId: 'temporary-leg',
          }),
        ],
      }),
    );

    expect(base).toHaveLength(1);
    expect(variants).toHaveLength(1);
    expect(variants[0]?.identityPreimage).toEqual(base[0]?.identityPreimage);
    expect(variants[0]?.contributors).toHaveLength(3);
  });

  it('keeps one atom for 100 coincident Services without adding contributors to identity', () => {
    const candidates = Array.from({ length: 100 }, (_, index) => {
      const suffix = index.toString().padStart(3, '0');
      return aCandidate({
        servicePlanId: `plan-${suffix}`,
        patternId: `pattern-${suffix}`,
        logicalPatternLegFragmentId: `logical-leg-${suffix}`,
      });
    });
    const oneContributor = readyAtoms(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates: [candidates[0]],
      }),
    );
    const atoms = readyAtoms(
      deriveExactCarrierLineSpanAtoms({
        lineId: 'line',
        carrierRule: 'shared-alignment',
        candidates,
      }),
    );

    expect(atoms).toHaveLength(1);
    expect(atoms[0]?.contributors).toHaveLength(100);
    expect(atoms[0]?.contributors.map(({ servicePlanId }) => servicePlanId)).toEqual(
      candidates.map(({ servicePlanId }) => servicePlanId),
    );
    expect(new Set(atoms[0]?.contributors.map(({ servicePlanId }) => servicePlanId)).size).toBe(
      100,
    );
    expect(atoms[0]?.identityPreimage).toEqual(oneContributor[0]?.identityPreimage);
  });
});
