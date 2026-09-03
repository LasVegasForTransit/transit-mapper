import { canonicalValueBytes } from '@transitmapper/core/encoding/canonical-value';
import type { TransitCarrierRef } from '@transitmapper/core/transit/value-types';
import type { TransitEntityKey } from '@transitmapper/core/model/transit-entity-ref';
import type { ResolvedNetworkProjection } from '../network/resolved-network-projection';
import {
  deriveExactLineCorrespondence,
  type ExactLineCorrespondence,
  type ExactLineCorrespondenceResult,
  type LineMaterialization,
} from './exact-line-correspondence';
import {
  advanceLineMaterializationSession,
  createLineMaterializationSession,
} from './line-materialization-session';
import {
  prepareLineSpanCandidateContext,
  type PrepareLineSpanCandidateContextResult,
} from './line-span-candidates';
import type { SameLineCarrierRule } from './line-span-candidate-groups';
import type { MaterializeExactLineSpansResult } from './line-span-materialization';
import type { LineSpan, VisibleLineSpanFragment } from './line-span-types';
import {
  deriveTopologyLineCorrespondence,
  type TopologyLineCorrespondence,
  type TopologyLineCorrespondenceResult,
} from './line-topology-correspondence';

export interface LineBundleMember {
  readonly lineId: string;
  readonly spans: readonly [LineSpan, ...LineSpan[]];
}

export type LineBundleCasingCandidate =
  | {
      readonly kind: 'exact-carrier';
      readonly canonicalCarrier: TransitCarrierRef;
      readonly canonicalCarrierRange: readonly [number, number];
    }
  | {
      readonly kind: 'topology';
      readonly topologyWindowIds: readonly [string, string];
      readonly startAnchorKey: TransitEntityKey;
      readonly endAnchorKey: TransitEntityKey;
    }
  | { readonly kind: 'line-span'; readonly lineSpanId: string };

export interface LineBundle {
  /** The semantic identity excludes source shards, viewport clipping, and visible geometry. */
  readonly id: string;
  readonly casing: LineBundleCasingCandidate;
  /** Each Line appears once, ordered solely by the complete result's `lineOrder`. */
  readonly members: readonly [LineBundleMember, ...LineBundleMember[]];
}

export interface VisibleLineBundleFragment {
  /** The visible identity includes source-fragment evidence, so it may vary by query. */
  readonly id: string;
  readonly lineBundleId: string;
  readonly lineId: string;
  readonly lineSpanId: string;
  readonly canonicalCarrierRange: readonly [number, number];
  readonly sourceShardIds: readonly [string, ...string[]];
  readonly geometry: VisibleLineSpanFragment['geometry'];
}

interface CompleteLineMaterialization extends LineMaterialization {
  readonly visibleFragments: readonly VisibleLineSpanFragment[];
}

type LineBundleCarrierRule = SameLineCarrierRule;

interface MaterializeLineBundlesOptions {
  readonly projection: ResolvedNetworkProjection;
  readonly carrierRule: LineBundleCarrierRule;
}

export type MaterializeLineBundlesResult =
  | {
      readonly kind: 'ready';
      readonly bundles: readonly LineBundle[];
      readonly visibleFragments: readonly VisibleLineBundleFragment[];
    }
  | Exclude<PrepareLineSpanCandidateContextResult, { readonly kind: 'ready' }>
  | Exclude<MaterializeExactLineSpansResult, { readonly kind: 'ready' }>
  | Exclude<ExactLineCorrespondenceResult, { readonly kind: 'ready' }>
  | Exclude<TopologyLineCorrespondenceResult, { readonly kind: 'ready' }>;

interface BundleCandidate {
  readonly casing: LineBundleCasingCandidate;
  readonly spans: readonly [LineSpan, ...LineSpan[]];
}

const textEncoder = new TextEncoder();

function compareTextBytes(leftBytes: Uint8Array, rightBytes: Uint8Array): number {
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

/** A comparator runs O(n log n) times over the same n strings, so encoding
 * inside it re-encodes each one for every comparison it takes part in. The
 * cache lives for one sort and is keyed by the exact string, so the ordering
 * is the one `compareText` would have produced. */
function textBytesMemo(): (text: string) => Uint8Array {
  const cache = new Map<string, Uint8Array>();
  return (text) => {
    const existing = cache.get(text);
    if (existing !== undefined) return existing;
    const encoded = textEncoder.encode(text);
    cache.set(text, encoded);
    return encoded;
  };
}

function digestCanonicalValue(value: unknown): Promise<string> {
  return crypto.subtle
    .digest('SHA-256', Uint8Array.from(canonicalValueBytes(value)).buffer)
    .then((buffer) =>
      Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    );
}

function lineRanks(projection: ResolvedNetworkProjection): ReadonlyMap<string, number> {
  return new Map(projection.result.lineOrder.map(({ lineId, rank }) => [lineId, rank]));
}

function membersFor(
  spans: readonly [LineSpan, ...LineSpan[]],
  ranks: ReadonlyMap<string, number>,
): readonly [LineBundleMember, ...LineBundleMember[]] {
  const spansByLineId = new Map<string, LineSpan[]>();
  for (const span of spans) {
    const lineSpans = spansByLineId.get(span.lineId);
    if (lineSpans === undefined) spansByLineId.set(span.lineId, [span]);
    else lineSpans.push(span);
  }
  const lineIdBytes = textBytesMemo();
  const members = [...spansByLineId]
    .sort(([leftLineId], [rightLineId]) => {
      const rankDifference = (ranks.get(leftLineId) ?? 0) - (ranks.get(rightLineId) ?? 0);
      return rankDifference === 0
        ? compareTextBytes(lineIdBytes(leftLineId), lineIdBytes(rightLineId))
        : rankDifference;
    })
    .map(([lineId, lineSpans]) => {
      const spanIdBytes = textBytesMemo();
      return {
        lineId,
        spans: [...lineSpans].sort((left, right) =>
          compareTextBytes(spanIdBytes(left.id), spanIdBytes(right.id)),
        ) as [LineSpan, ...LineSpan[]],
      };
    });
  const [first, ...rest] = members;
  return [first, ...rest];
}

async function bundleFor(
  candidate: BundleCandidate,
  ranks: ReadonlyMap<string, number>,
): Promise<LineBundle> {
  const members = membersFor(candidate.spans, ranks);
  return {
    id: await digestCanonicalValue({
      version: 'line-bundle-v1',
      casing: candidate.casing,
      members: members.map(({ lineId, spans }) => ({
        lineId,
        lineSpanIds: spans.map(({ id }) => id),
      })),
    }),
    casing: candidate.casing,
    members,
  };
}

function exactBundleCandidates(
  correspondence: ExactLineCorrespondence,
): readonly [BundleCandidate, ...BundleCandidate[]] {
  return [
    {
      casing: {
        kind: 'exact-carrier',
        canonicalCarrier: correspondence.canonicalCarrier,
        canonicalCarrierRange: correspondence.canonicalCarrierRange,
      },
      spans: correspondence.members,
    },
  ];
}

function topologyBundleCandidates(
  correspondence: TopologyLineCorrespondence,
): readonly [BundleCandidate, ...BundleCandidate[]] {
  return [
    {
      casing: {
        kind: 'topology',
        topologyWindowIds: correspondence.topologyWindowIds,
        startAnchorKey: correspondence.startAnchorKey,
        endAnchorKey: correspondence.endAnchorKey,
      },
      spans: correspondence.members,
    },
  ];
}

function singletonBundleCandidates(
  materializations: readonly CompleteLineMaterialization[],
  usedSpanIds: ReadonlySet<string>,
): readonly BundleCandidate[] {
  return materializations.flatMap(({ spans }) =>
    spans
      .filter(({ id }) => !usedSpanIds.has(id))
      .map((span) => ({
        casing: { kind: 'line-span', lineSpanId: span.id } as const,
        spans: [span] as [LineSpan],
      })),
  );
}

function bundleIdsBySpanId(bundles: readonly LineBundle[]): ReadonlyMap<string, readonly string[]> {
  const bundleIdsBySpanId = new Map<string, string[]>();
  for (const bundle of bundles) {
    for (const member of bundle.members) {
      for (const span of member.spans) {
        const ids = bundleIdsBySpanId.get(span.id);
        if (ids === undefined) bundleIdsBySpanId.set(span.id, [bundle.id]);
        else ids.push(bundle.id);
      }
    }
  }
  return bundleIdsBySpanId;
}

async function visibleBundleFragmentsForMaterialization(
  materialization: CompleteLineMaterialization,
  bundleIdsBySpanId: ReadonlyMap<string, readonly string[]>,
): Promise<readonly VisibleLineBundleFragment[]> {
  const fragments: VisibleLineBundleFragment[] = [];
  for (const fragment of materialization.visibleFragments) {
    for (const lineBundleId of bundleIdsBySpanId.get(fragment.lineSpanId) ?? []) {
      fragments.push({
        id: await digestCanonicalValue({
          version: 'visible-line-bundle-fragment-v1',
          lineBundleId,
          lineId: materialization.lineId,
          lineSpanId: fragment.lineSpanId,
          lineSpanFragmentId: fragment.id,
          sourceShardIds: fragment.sourceShardIds,
        }),
        lineBundleId,
        lineId: materialization.lineId,
        lineSpanId: fragment.lineSpanId,
        canonicalCarrierRange: fragment.canonicalCarrierRange,
        sourceShardIds: fragment.sourceShardIds,
        geometry: fragment.geometry,
      });
    }
  }
  return fragments;
}

async function visibleBundleFragments(
  bundles: readonly LineBundle[],
  materializations: readonly CompleteLineMaterialization[],
): Promise<readonly VisibleLineBundleFragment[]> {
  const bundleIds = bundleIdsBySpanId(bundles);
  const byMaterialization = await Promise.all(
    materializations.map((materialization) =>
      visibleBundleFragmentsForMaterialization(materialization, bundleIds),
    ),
  );
  return byMaterialization.flat();
}

/**
 * Materializes every ranked Line before correspondence so the browser receives
 * one all-or-nothing bundle aggregate and never receives projection indexes.
 */
export async function materializeLineBundles(
  options: MaterializeLineBundlesOptions,
): Promise<MaterializeLineBundlesResult> {
  const prepared = prepareLineSpanCandidateContext(options.projection);
  if (prepared.kind !== 'ready') return prepared;
  let session = createLineMaterializationSession({
    context: prepared.context,
    carrierRule: options.carrierRule,
  });
  const materializations: CompleteLineMaterialization[] = [];
  for (;;) {
    const advanced = await advanceLineMaterializationSession(session);
    if (advanced.kind === 'complete') break;
    session = advanced.next;
    if (advanced.materialization.kind !== 'ready') return advanced.materialization;
    materializations.push({
      lineId: advanced.lineId,
      spans: advanced.materialization.spans,
      visibleFragments: advanced.materialization.visibleFragments,
    });
  }
  const correspondence = deriveExactLineCorrespondence({
    lineOrder: options.projection.result.lineOrder,
    materializations,
  });
  if (correspondence.kind !== 'ready') return correspondence;
  const candidates = correspondence.correspondences.flatMap(exactBundleCandidates);
  const exactSpanIds = new Set(candidates.flatMap(({ spans }) => spans.map(({ id }) => id)));
  const topology = await deriveTopologyLineCorrespondence({
    projection: options.projection,
    context: prepared.context,
    materializations,
    excludedSpanIds: exactSpanIds,
  });
  if (topology.kind !== 'ready') return topology;
  candidates.push(...topology.correspondences.flatMap(topologyBundleCandidates));
  const usedSpanIds = new Set(candidates.flatMap(({ spans }) => spans.map(({ id }) => id)));
  candidates.push(...singletonBundleCandidates(materializations, usedSpanIds));
  const ranks = lineRanks(options.projection);
  const bundles: LineBundle[] = [];
  for (const candidate of candidates) bundles.push(await bundleFor(candidate, ranks));
  return {
    kind: 'ready',
    bundles,
    visibleFragments: await visibleBundleFragments(bundles, materializations),
  };
}
