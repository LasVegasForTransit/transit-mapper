import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { createSchemaV16SystemProvider } from '@transitmapper/core/network/schema-v16-system-provider';
import { renderFeatureId, systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { modeRender } from '@transitmapper/core/style/catalogStyle';
import { SRC_SERVICES } from '../layers/constants';
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

type ReadyLineBundles = Extract<MaterializeLineBundlesResult, { readonly kind: 'ready' }>;

export interface LineSceneCache {
  readonly key: string;
  readonly projection: ResolvedNetworkProjection;
  readonly materialized: ReadyLineBundles;
}

export interface ProjectLineSceneOptions {
  readonly system: TransitSystem;
  readonly cache?: LineSceneCache;
}

export interface ProjectLineSceneResult {
  readonly cache: LineSceneCache;
  readonly features: FeatureCollection<LineString>;
}

interface LineStripe {
  readonly fragment: VisibleLineBundleFragment;
  readonly color: string;
  readonly width: number;
  readonly rank: number;
}

const WORLD_QUERY = {
  serviceTime: { kind: 'live' as const },
  modes: { kind: 'all' as const },
  filters: {},
  bounds: { kind: 'ordinary' as const, west: -180, south: -90, east: 180, north: 90 },
  detailBand: 'district' as const,
};
const SERVICE_SOURCE_ID = systemFeatureSourceId(SRC_SERVICES);

function cacheKey(system: TransitSystem): string {
  return `${system.id}\u001f${system.updatedAt}`;
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
  cache: LineSceneCache,
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
  const servicePlan = cache.projection.index.servicePlansById.get(
    span.contributors[0].servicePlanId,
  );
  const modeId = servicePlan?.mode.kind === 'known' ? servicePlan.mode.value : 'bus';
  const line = cache.projection.index.linesById.get(fragment.lineId);
  const rank = cache.projection.result.lineOrder.find(
    ({ lineId }) => lineId === fragment.lineId,
  )?.rank;
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

function sceneFeatures(cache: LineSceneCache): Feature<LineString>[] {
  const bundlesById = new Map(cache.materialized.bundles.map((bundle) => [bundle.id, bundle]));
  const fragmentsByCorridor = new Map<string, VisibleLineBundleFragment[]>();
  for (const fragment of cache.materialized.visibleFragments) {
    const fragments = fragmentsByCorridor.get(corridorKey(fragment));
    if (fragments) fragments.push(fragment);
    else fragmentsByCorridor.set(corridorKey(fragment), [fragment]);
  }
  const features: Feature<LineString>[] = [];
  for (const fragments of [...fragmentsByCorridor.values()].sort((left, right) =>
    corridorKey(left[0]).localeCompare(corridorKey(right[0])),
  )) {
    const stripeByLineId = new Map<string, LineStripe>();
    for (const fragment of fragments) {
      const stripe = stripeFor(cache, bundlesById, fragment);
      const current = stripeByLineId.get(fragment.lineId);
      if (!current || compareStripes(stripe, current) < 0)
        stripeByLineId.set(fragment.lineId, stripe);
    }
    const stripes = [...stripeByLineId.values()].sort(compareStripes);
    const casing = stripes[0];
    const totalWidth = stripes.reduce((sum, stripe) => sum + stripe.width, 0) + stripes.length - 1;
    features.push({
      type: 'Feature',
      id: renderFeatureId(SERVICE_SOURCE_ID, 'line-casing', [casing.fragment.id]),
      properties: {
        routeRole: 'casing',
        width: totalWidth,
        offset: 0,
        renderTier: 'overview',
        tierOpacity: 1,
      },
      geometry: casing.fragment.geometry,
    });
    let offset = -totalWidth / 2;
    for (const stripe of stripes) {
      offset += stripe.width / 2;
      features.push({
        type: 'Feature',
        id: renderFeatureId(SERVICE_SOURCE_ID, 'line-stripe', [stripe.fragment.id]),
        properties: {
          routeRole: 'stripe',
          lineId: stripe.fragment.lineId,
          color: stripe.color,
          width: stripe.width,
          offset,
          renderTier: 'overview',
          tierOpacity: 1,
        },
        geometry: stripe.fragment.geometry,
      });
      offset += stripe.width / 2 + 1;
    }
  }
  return features;
}

async function createCache(system: TransitSystem): Promise<LineSceneCache> {
  const provider = createSchemaV16SystemProvider(system);
  const descriptor = await provider.describe({
    kind: 'transit-system',
    id: system.id,
    revision: { kind: 'latest' },
  });
  const result = await provider.resolve(descriptor.content, WORLD_QUERY);
  const projection = projectResolvedNetwork(result, {
    camera: { center: system.viewport.center, zoom: system.viewport.zoom, bearing: 0, pitch: 0 },
    representationId: 'network',
  });
  const materialized = await materializeLineBundles({
    projection,
    carrierRule: 'shared-alignment',
  });
  if (materialized.kind !== 'ready') {
    throw new Error(`Line scene materialization did not settle: ${materialized.kind}.`);
  }
  return { key: cacheKey(system), projection, materialized };
}

/** Builds one Line-first service collection without exposing materialization state outside the Worker. */
export async function projectLineScene({
  system,
  cache,
}: ProjectLineSceneOptions): Promise<ProjectLineSceneResult> {
  const retained = cache?.key === cacheKey(system) ? cache : await createCache(system);
  return {
    cache: retained,
    features: { type: 'FeatureCollection', features: sceneFeatures(retained) },
  };
}
