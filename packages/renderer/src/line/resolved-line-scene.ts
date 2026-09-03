import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { NetworkQueryResult } from '@transitmapper/core/network/result';
import type { MapPresentation } from '@transitmapper/core/presentation/map-presentation';
import {
  createRenderIdentityIndex,
  renderDomainIdentity,
  renderFeatureId,
  type RenderIdentityBinding,
  type SystemFeatureSourceId,
} from '@transitmapper/core/render/render-identity';
import {
  createRenderScene,
  emptyRenderSceneStats,
  renderSceneRevision,
  type RenderScene,
  type RenderSceneStats,
} from '@transitmapper/core/render/render-scene';
import { featureCollectionStats } from '@transitmapper/core/render/feature-stats';
import { modeRender } from '@transitmapper/core/style/catalogStyle';
import {
  projectResolvedNetwork,
  type ResolvedNetworkProjection,
} from '../network/resolved-network-projection';
import {
  materializeLineBundles,
  type LineBundle,
  type MaterializeLineBundlesResult,
  type VisibleLineBundleFragment,
} from './line-bundles';
import type { LineSpanContributor } from './line-span-types';

type ReadyLineBundles = Extract<MaterializeLineBundlesResult, { readonly kind: 'ready' }>;

export interface ProjectResolvedLineSceneOptions {
  readonly result: NetworkQueryResult;
  readonly presentation: MapPresentation;
  readonly sceneRevision: string;
  readonly sourceId: SystemFeatureSourceId;
}

export interface ResolvedLineScene {
  readonly projection: ResolvedNetworkProjection;
  readonly materialized: ReadyLineBundles;
  readonly scene: RenderScene;
  /** Maps every passenger Line to its complete semantic spans, not just the
   * currently clipped geometry that happens to paint in this request. */
  readonly lineSpanIdsByLineId: ReadonlyMap<string, readonly string[]>;
  /** Keeps operational contributors available to an inspector without adding
   * ServicePlan or Pattern identity to permanent route features. */
  readonly contributorsByLineId: ReadonlyMap<string, readonly LineSpanContributor[]>;
}

interface LineStripe {
  readonly fragment: VisibleLineBundleFragment;
  readonly color: string;
  readonly width: number;
  readonly rank: number;
}

interface LineSceneFeatures {
  readonly collection: FeatureCollection<LineString>;
  readonly bindings: readonly RenderIdentityBinding[];
}

function geometryKey(fragment: VisibleLineBundleFragment): string {
  const forward = JSON.stringify(fragment.geometry.coordinates);
  const reverse = JSON.stringify([...fragment.geometry.coordinates].reverse());
  return forward < reverse ? forward : reverse;
}

function corridorKey(fragment: VisibleLineBundleFragment): string {
  return [
    fragment.lineBundleId,
    fragment.canonicalCarrierRange[0],
    fragment.canonicalCarrierRange[1],
    geometryKey(fragment),
  ].join('\u001f');
}

function bundleFor(
  bundlesById: ReadonlyMap<string, LineBundle>,
  fragment: VisibleLineBundleFragment,
): LineBundle {
  const bundle = bundlesById.get(fragment.lineBundleId);
  if (!bundle) throw new Error(`Line scene is missing bundle ${fragment.lineBundleId}.`);
  return bundle;
}

function stripeFor(
  projection: ResolvedNetworkProjection,
  bundlesById: ReadonlyMap<string, LineBundle>,
  fragment: VisibleLineBundleFragment,
): LineStripe {
  const bundle = bundleFor(bundlesById, fragment);
  const member = bundle.members.find(
    ({ lineId, spans }) =>
      lineId === fragment.lineId && spans.some(({ id }) => id === fragment.lineSpanId),
  );
  if (!member) throw new Error(`Line scene is missing member ${fragment.lineId}.`);
  const span = member.spans.find(({ id }) => id === fragment.lineSpanId);
  if (!span) throw new Error(`Line scene is missing span ${fragment.lineSpanId}.`);
  const servicePlan = projection.index.servicePlansById.get(span.contributors[0].servicePlanId);
  const modeId = servicePlan?.mode.kind === 'known' ? servicePlan.mode.value : 'bus';
  const line = projection.index.linesById.get(fragment.lineId);
  const rank = projection.result.lineOrder.find(({ lineId }) => lineId === fragment.lineId)?.rank;
  return {
    fragment,
    color: line?.color ?? modeRender(modeId).color,
    width: modeRender(modeId).width,
    rank: rank ?? Number.MAX_SAFE_INTEGER,
  };
}

function compareStripes(left: LineStripe, right: LineStripe): number {
  return left.rank - right.rank || left.fragment.id.localeCompare(right.fragment.id);
}

function sceneFeatures(
  projection: ResolvedNetworkProjection,
  materialized: ReadyLineBundles,
  sourceId: SystemFeatureSourceId,
): LineSceneFeatures {
  const bundlesById = new Map(materialized.bundles.map((bundle) => [bundle.id, bundle]));
  const fragmentsByCorridor = new Map<string, VisibleLineBundleFragment[]>();
  for (const fragment of materialized.visibleFragments) {
    const fragments = fragmentsByCorridor.get(corridorKey(fragment));
    if (fragments) fragments.push(fragment);
    else fragmentsByCorridor.set(corridorKey(fragment), [fragment]);
  }
  const features: Feature<LineString>[] = [];
  const bindings: RenderIdentityBinding[] = [];
  for (const fragments of [...fragmentsByCorridor.values()].sort((left, right) =>
    corridorKey(left[0]).localeCompare(corridorKey(right[0])),
  )) {
    const stripeByLineId = new Map<string, LineStripe>();
    for (const fragment of fragments) {
      const stripe = stripeFor(projection, bundlesById, fragment);
      const current = stripeByLineId.get(fragment.lineId);
      if (!current || compareStripes(stripe, current) < 0)
        stripeByLineId.set(fragment.lineId, stripe);
    }
    const stripes = [...stripeByLineId.values()].sort(compareStripes);
    const casing = stripes[0];
    const totalWidth = stripes.reduce((sum, stripe) => sum + stripe.width, 0) + stripes.length - 1;
    features.push({
      type: 'Feature',
      id: renderFeatureId(sourceId, 'line-casing', [casing.fragment.id]),
      properties: {
        routeRole: 'casing',
        width: totalWidth,
        offset: 0,
        renderTier: 'overview',
        renderOrder: -1,
        tierOpacity: 1,
      },
      geometry: casing.fragment.geometry,
    });
    let offset = -totalWidth / 2;
    for (const [stripeIndex, stripe] of stripes.entries()) {
      offset += stripe.width / 2;
      const featureId = renderFeatureId(sourceId, 'line-stripe', [stripe.fragment.id]);
      features.push({
        type: 'Feature',
        id: featureId,
        properties: {
          routeRole: 'stripe',
          lineId: stripe.fragment.lineId,
          color: stripe.color,
          width: stripe.width,
          offset,
          renderTier: 'overview',
          renderOrder: stripeIndex,
          tierOpacity: 1,
        },
        geometry: stripe.fragment.geometry,
      });
      bindings.push({
        domainIdentity: renderDomainIdentity('line', stripe.fragment.lineId),
        renderFeatureIds: [featureId],
      });
      offset += stripe.width / 2 + 1;
    }
  }
  return { collection: { type: 'FeatureCollection', features }, bindings };
}

function lineSpanIdsByLineId(
  materialized: ReadyLineBundles,
): ReadonlyMap<string, readonly string[]> {
  const idsByLineId = new Map<string, string[]>();
  for (const bundle of materialized.bundles) {
    for (const member of bundle.members) {
      const ids = idsByLineId.get(member.lineId) ?? [];
      ids.push(...member.spans.map(({ id }) => id));
      idsByLineId.set(member.lineId, ids);
    }
  }
  return new Map(
    [...idsByLineId].map(([lineId, ids]) => [lineId, [...new Set(ids)].sort()] as const),
  );
}

function contributorsByLineId(
  materialized: ReadyLineBundles,
): ReadonlyMap<string, readonly LineSpanContributor[]> {
  const contributors = new Map<string, LineSpanContributor[]>();
  for (const bundle of materialized.bundles) {
    for (const member of bundle.members) {
      const lineContributors = contributors.get(member.lineId) ?? [];
      for (const span of member.spans) lineContributors.push(...span.contributors);
      contributors.set(member.lineId, lineContributors);
    }
  }
  return new Map(
    [...contributors].map(([lineId, values]) => {
      const distinct = new Map(
        values.map((value) => [
          `${value.servicePlanId}\u001f${value.patternId}\u001f${value.legIndex}`,
          value,
        ]),
      );
      return [
        lineId,
        [...distinct.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([, value]) => value),
      ] as const;
    }),
  );
}

function sceneStats(collection: FeatureCollection): RenderSceneStats {
  const counts = featureCollectionStats([collection]);
  return {
    ...emptyRenderSceneStats(),
    candidateFeatureCount: counts.featureCount,
    visibleFeatureCount: counts.featureCount,
    generatedVisualFeatureCount: counts.featureCount,
    generatedVertexCount: counts.vertexCount,
  };
}

/** Projects already-resolved transit facts. It never fetches content, chooses
 * a camera query, or imports a host or map-library value. */
export async function projectResolvedLineScene(
  options: ProjectResolvedLineSceneOptions,
): Promise<ResolvedLineScene> {
  const projection = projectResolvedNetwork(options.result, options.presentation);
  const materialized = await materializeLineBundles({
    projection,
    carrierRule: 'shared-alignment',
  });
  if (materialized.kind !== 'ready') {
    throw new Error(`Line scene materialization did not settle: ${materialized.kind}.`);
  }
  const features = sceneFeatures(projection, materialized, options.sourceId);
  return {
    projection,
    materialized,
    scene: createRenderScene({
      revision: renderSceneRevision(options.sceneRevision),
      featuresBySource: new Map([[options.sourceId, features.collection]]),
      hitFeatures: { type: 'FeatureCollection', features: [] },
      identityIndex: createRenderIdentityIndex(features.bindings),
      stats: sceneStats(features.collection),
    }),
    lineSpanIdsByLineId: lineSpanIdsByLineId(materialized),
    contributorsByLineId: contributorsByLineId(materialized),
  };
}
