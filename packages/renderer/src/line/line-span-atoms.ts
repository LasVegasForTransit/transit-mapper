import { mapNormalizedPosition } from '@transitmapper/core/network/carrier-alignment';
import type {
  Grade,
  KnownOrUnknown,
  LegDirection,
  TransitCarrierRef,
} from '@transitmapper/core/transit/value-types';
import type {
  CandidateCarrierAlignmentMapping,
  LineSpanCandidate,
  ValidatedLineSpanCandidates,
} from './line-span-candidates';
import {
  compareLineSpanCandidates,
  lineSpanCandidateRange,
  prepareExactCarrierGroups,
  type ExactCarrierCandidateRejectionReason,
  type ExactCarrierGroup,
  type PreparedLineSpanCandidate,
  type SameLineCarrierRule,
} from './line-span-candidate-groups';
import type { LineSpanContributor } from './line-span-types';

interface ExactCarrierLineSpanIdentityPreimage {
  readonly version: 'line-overlap-v1';
  readonly kind: 'exact-carrier';
  readonly lineId: string;
  readonly canonicalCarrier: TransitCarrierRef;
  readonly canonicalCarrierRange: readonly [number, number];
}

interface ExactCarrierLineSpanAtom {
  readonly lineId: string;
  readonly canonicalCarrier: TransitCarrierRef;
  readonly canonicalCarrierRange: readonly [number, number];
  readonly identityPreimage: ExactCarrierLineSpanIdentityPreimage;
  readonly contributors: readonly [LineSpanContributor, ...LineSpanContributor[]];
}

interface ExactCarrierContributorEvidence {
  readonly contributorIndex: number;
  readonly logicalPatternLegFragmentIds: readonly [string, ...string[]];
  readonly shardIds: readonly [string, ...string[]];
  readonly visibleShardIds: readonly string[];
}

interface ExactCarrierLineSpanEvidence {
  readonly atomIndex: number;
  readonly contributors: readonly [
    ExactCarrierContributorEvidence,
    ...ExactCarrierContributorEvidence[],
  ];
}

interface DeferredExactCarrierContributor {
  readonly reason: 'bare-alignment' | 'unresolved-lane';
  readonly lineId: string;
  readonly servicePlanId: string;
  readonly servicePlanMode: KnownOrUnknown<string>;
  readonly patternId: string;
  readonly legIndex: number;
  readonly direction: LegDirection;
  readonly carrier: TransitCarrierRef;
  readonly carrierGrade: Grade | undefined;
  readonly alignmentId: string;
  readonly alignmentMapping: CandidateCarrierAlignmentMapping;
  readonly logicalCarrierRange: readonly [number, number];
}

interface DeferredExactCarrierEvidence {
  readonly deferredIndex: number;
  readonly logicalPatternLegFragmentIds: readonly [string, ...string[]];
  readonly shardIds: readonly [string, ...string[]];
  readonly visibleShardIds: readonly string[];
}

type ExactCarrierLineSpanRejectionReason =
  'identity-range-collapse' | ExactCarrierCandidateRejectionReason;

export type ExactCarrierLineSpanDerivation =
  | {
      readonly kind: 'ready';
      readonly atoms: readonly ExactCarrierLineSpanAtom[];
      readonly evidence: readonly ExactCarrierLineSpanEvidence[];
      readonly deferred: readonly DeferredExactCarrierContributor[];
      readonly deferredEvidence: readonly DeferredExactCarrierEvidence[];
    }
  | {
      readonly kind: 'rejected';
      readonly reason: ExactCarrierLineSpanRejectionReason;
      readonly recordId: string;
    };

export interface DeriveExactCarrierLineSpanAtomsOptions {
  readonly lineId: string;
  readonly carrierRule: SameLineCarrierRule;
  readonly candidates: ValidatedLineSpanCandidates;
}

type RejectedDerivation = Extract<ExactCarrierLineSpanDerivation, { readonly kind: 'rejected' }>;

interface PreparedContributor {
  readonly contributor: LineSpanContributor;
  readonly logicalPatternLegFragmentIds: readonly [string, ...string[]];
  readonly shardIds: readonly [string, ...string[]];
  readonly visibleShardIds: readonly string[];
}

interface AppendGroupOptions {
  readonly lineId: string;
  readonly group: ExactCarrierGroup;
  readonly carrierRule: SameLineCarrierRule;
}

interface ExactCarrierOutput {
  readonly atoms: ExactCarrierLineSpanAtom[];
  readonly evidence: ExactCarrierLineSpanEvidence[];
}

const IDENTITY_RANGE_SCALE = 1_000_000;

function rejected(
  reason: ExactCarrierLineSpanRejectionReason,
  recordId: string,
): RejectedDerivation {
  return { kind: 'rejected', reason, recordId };
}

function contributorCarrierRange(
  candidate: LineSpanCandidate,
  range: readonly [number, number],
  rule: SameLineCarrierRule,
): readonly [number, number] {
  if (rule === 'same-physical-carrier' || candidate.alignmentMapping.kind === 'identity') {
    return range;
  }
  const candidateAlignmentRange = lineSpanCandidateRange(candidate, rule);
  return [
    range[0] === candidateAlignmentRange[0]
      ? candidate.logicalCarrierRange[0]
      : mapNormalizedPosition(range[0], candidate.alignmentMapping.alignmentExtent, [0, 1]),
    range[1] === candidateAlignmentRange[1]
      ? candidate.logicalCarrierRange[1]
      : mapNormalizedPosition(range[1], candidate.alignmentMapping.alignmentExtent, [0, 1]),
  ];
}

function prepareContributors(
  activeCandidates: readonly PreparedLineSpanCandidate[],
  range: readonly [number, number],
  rule: SameLineCarrierRule,
): readonly PreparedContributor[] {
  return [...activeCandidates]
    .sort((left, right) => compareLineSpanCandidates(left.candidate, right.candidate))
    .map((prepared) => {
      const { candidate } = prepared;
      return {
        contributor: {
          servicePlanId: candidate.servicePlanId,
          patternId: candidate.patternId,
          legIndex: candidate.legIndex,
          carrier: candidate.carrier,
          carrierRange: contributorCarrierRange(candidate, range, rule),
          spanRange: candidate.direction === 'forward' ? [0, 1] : [1, 0],
        },
        logicalPatternLegFragmentIds: prepared.logicalPatternLegFragmentIds,
        shardIds: prepared.shardIds,
        visibleShardIds: prepared.visibleShardIds,
      } satisfies PreparedContributor;
    });
}

function identityPosition(value: number): number {
  const quantized = Math.floor(value * IDENTITY_RANGE_SCALE + 0.5) / IDENTITY_RANGE_SCALE;
  return Object.is(quantized, -0) ? 0 : quantized;
}

function identityRange(range: readonly [number, number]): readonly [number, number] | undefined {
  const quantized = [identityPosition(range[0]), identityPosition(range[1])] as const;
  return quantized[0] === quantized[1] ? undefined : quantized;
}

function groupBoundaries(group: ExactCarrierGroup, rule: SameLineCarrierRule): readonly number[] {
  const boundaries = new Set<number>();
  for (const { candidate } of group.candidates) {
    const [start, end] = lineSpanCandidateRange(candidate, rule);
    boundaries.add(Object.is(start, -0) ? 0 : start);
    boundaries.add(Object.is(end, -0) ? 0 : end);
  }
  return [...boundaries].sort((left, right) => left - right);
}

function activeCandidates(
  group: ExactCarrierGroup,
  range: readonly [number, number],
  rule: SameLineCarrierRule,
): readonly PreparedLineSpanCandidate[] {
  return group.candidates.filter(({ candidate }) => {
    const candidateExtent = lineSpanCandidateRange(candidate, rule);
    return candidateExtent[0] < range[1] && candidateExtent[1] > range[0];
  });
}

function appendGroupAtoms(
  options: AppendGroupOptions,
  output: ExactCarrierOutput,
): RejectedDerivation | undefined {
  const boundaries = groupBoundaries(options.group, options.carrierRule);
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const range = [boundaries[index], boundaries[index + 1]] as const;
    if (!(range[0] < range[1])) continue;
    const active = activeCandidates(options.group, range, options.carrierRule);
    if (active.length === 0) continue;
    const prepared = prepareContributors(active, range, options.carrierRule);
    const semanticRange = identityRange(range);
    if (semanticRange === undefined) {
      const recordId = [...active].sort((left, right) =>
        compareLineSpanCandidates(left.candidate, right.candidate),
      )[0].recordId;
      return rejected('identity-range-collapse', recordId);
    }
    const atomIndex = output.atoms.length;
    output.atoms.push({
      lineId: options.lineId,
      canonicalCarrier: options.group.canonicalCarrier,
      canonicalCarrierRange: range,
      identityPreimage: {
        version: 'line-overlap-v1',
        kind: 'exact-carrier',
        lineId: options.lineId,
        canonicalCarrier: options.group.canonicalCarrier,
        canonicalCarrierRange: semanticRange,
      },
      contributors: prepared.map(({ contributor }) => contributor) as [
        LineSpanContributor,
        ...LineSpanContributor[],
      ],
    });
    output.evidence.push({
      atomIndex,
      contributors: prepared.map(
        ({ logicalPatternLegFragmentIds, shardIds, visibleShardIds }, contributorIndex) => ({
          contributorIndex,
          logicalPatternLegFragmentIds,
          shardIds,
          visibleShardIds,
        }),
      ) as [ExactCarrierContributorEvidence, ...ExactCarrierContributorEvidence[]],
    });
  }
  return undefined;
}

function deferredContributor(
  reason: DeferredExactCarrierContributor['reason'],
  candidate: LineSpanCandidate,
): DeferredExactCarrierContributor {
  return {
    reason,
    lineId: candidate.lineId,
    servicePlanId: candidate.servicePlanId,
    servicePlanMode: candidate.servicePlanMode,
    patternId: candidate.patternId,
    legIndex: candidate.legIndex,
    direction: candidate.direction,
    carrier: candidate.carrier,
    carrierGrade: candidate.carrierGrade,
    alignmentId: candidate.alignmentId,
    alignmentMapping: candidate.alignmentMapping,
    logicalCarrierRange: candidate.logicalCarrierRange,
  };
}

/**
 * Splits validated Line candidates on exact semantic-carrier boundaries.
 * Topology inference, geometry slicing, and scene publication remain separate stages.
 */
export function deriveExactCarrierLineSpanAtoms(
  options: DeriveExactCarrierLineSpanAtomsOptions,
): ExactCarrierLineSpanDerivation {
  const prepared = prepareExactCarrierGroups(
    options.lineId,
    options.candidates,
    options.carrierRule,
  );
  if (prepared.kind === 'rejected') return prepared;
  const output: ExactCarrierOutput = { atoms: [], evidence: [] };
  for (const group of prepared.groups) {
    const rejection = appendGroupAtoms(
      { lineId: options.lineId, group, carrierRule: options.carrierRule },
      output,
    );
    if (rejection) return rejection;
  }
  return {
    kind: 'ready',
    atoms: output.atoms,
    evidence: output.evidence,
    deferred: prepared.deferred.map(({ reason, prepared: entry }) =>
      deferredContributor(reason, entry.candidate),
    ),
    deferredEvidence: prepared.deferred.map(({ prepared: entry }, deferredIndex) => ({
      deferredIndex,
      logicalPatternLegFragmentIds: entry.logicalPatternLegFragmentIds,
      shardIds: entry.shardIds,
      visibleShardIds: entry.visibleShardIds,
    })),
  };
}
