import type { FeatureCollection, LineString } from 'geojson';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { NetworkQuery } from '@transitmapper/core/network/query';
import type { ContentProvider } from '@transitmapper/core/network/content-provider';
import type { ResolvedContentRef } from '@transitmapper/core/network/resolved-content-reference';
import { createSchemaV16SystemProvider } from '@transitmapper/core/network/schema-v16-system-provider';
import type { RenderViewOptions } from '@transitmapper/core/render/buildFeatures';
import type { RenderPresentation } from '@transitmapper/core/render/render-presentation';
import { systemFeatureSourceId } from '@transitmapper/core/render/render-identity';
import { SRC_SERVICES } from '../layers/constants';
import { queryDetailBand } from '../render-presentation';
import { projectResolvedLineScene, type ResolvedLineScene } from './resolved-line-scene';

export interface ProjectSchemaV16LineSceneOptions {
  readonly system: TransitSystem;
  readonly view: RenderViewOptions;
  readonly sceneRevision: string;
  /** Which geometry `system` carries. A Diagram layout is spread from the
   * authored System, so it keeps the same id and `updatedAt` and only this
   * says which of the two arrived. Callers with no layout omit it: their
   * content is the authored System whatever view mode they are painting. */
  readonly layout?: SystemLayout;
  /** Stops the resolve part-way. The provider rechecks it at every checkpoint
   * and yields to the host in between, so a superseded projection gives its
   * remaining chunks back to the caller instead of running to completion.
   * Callers with no supersession — exports, previews, tests — omit it. */
  readonly signal?: AbortSignal;
}

type SystemLayout = 'authored' | 'diagram';

const SERVICE_SOURCE_ID = systemFeatureSourceId(SRC_SERVICES);

function boundsFor(view: RenderViewOptions): NetworkQuery['bounds'] {
  const { southwest, northeast } = view.presentation.bounds;
  return {
    kind: southwest[0] <= northeast[0] ? 'ordinary' : 'crosses-antimeridian',
    west: southwest[0],
    south: southwest[1],
    east: northeast[0],
    north: northeast[1],
  };
}

function queryFor(view: RenderViewOptions): NetworkQuery {
  return {
    serviceTime: { kind: 'live' },
    modes: { kind: 'only', ids: [...view.visibleModes].sort() },
    filters: {},
    bounds: boundsFor(view),
    detailBand: queryDetailBand(view.presentation),
  };
}

interface DescribedContent {
  readonly provider: ContentProvider;
  readonly content: ResolvedContentRef;
}

/** Describing a System deep-clones, validates, and digests it, and none of
 * that depends on the camera. Rebuilding a provider per projection made
 * panning pay it every frame: 993 ms of a 1,437 ms projection on a
 * 3,800-way network.
 *
 * The key is the TransitSystem object itself. No value key is sound here:
 * `updatedAt` is stamped `Date.now()` when the store finalizes an edit, so
 * two edits in one millisecond share a key while carrying different content.
 * The store rebuilds the object on every mutation, so reference equality
 * separates them for free. Nothing evicts because the object graph already
 * bounds this: an entry dies with the document it describes.
 *
 * Layout is a second axis. A Diagram System is spread from its authored
 * original, and a Diagram request arriving before its layout falls back to
 * the authored System, so the two must not share an entry.
 */
const describedContent = new WeakMap<TransitSystem, Map<SystemLayout, Promise<DescribedContent>>>();

function describeSystem(system: TransitSystem, layout: SystemLayout): Promise<DescribedContent> {
  let byLayout = describedContent.get(system);
  if (!byLayout) {
    byLayout = new Map<SystemLayout, Promise<DescribedContent>>();
    describedContent.set(system, byLayout);
  }
  const cached = byLayout.get(layout);
  if (cached) return cached;
  const described = buildDescribedContent(system);
  // The promise is cached rather than its value because two projections can
  // interleave in one worker. A rejection must not become the permanent
  // answer for this document, so it drops out again.
  byLayout.set(layout, described);
  void described.catch(() => {
    if (byLayout.get(layout) === described) byLayout.delete(layout);
  });
  return described;
}

async function buildDescribedContent(system: TransitSystem): Promise<DescribedContent> {
  const provider = createSchemaV16SystemProvider(system);
  const descriptor = await provider.describe({
    kind: 'transit-system',
    id: system.id,
    revision: { kind: 'latest' },
  });
  return { provider, content: descriptor.content };
}

interface ResolveLineSceneOptions {
  readonly system: TransitSystem;
  readonly layout: SystemLayout;
  readonly query: NetworkQuery;
  readonly presentation: RenderPresentation;
  readonly sceneRevision: string;
  readonly signal?: AbortSignal;
}

async function resolveSchemaV16LineScene({
  system,
  layout,
  query,
  presentation,
  sceneRevision,
  signal,
}: ResolveLineSceneOptions): Promise<ResolvedLineScene> {
  // `describeSystem` is deliberately not given the signal. Its promise is
  // shared by every projection of this document, so one caller's supersession
  // would reject the description that the caller superseding it is about to
  // wait on. Only the per-request resolve below is cancellable.
  const { provider, content } = await describeSystem(system, layout);
  const result = await provider.resolve(content, query, { signal });
  return projectResolvedLineScene({
    result,
    presentation,
    sceneRevision,
    sourceId: SERVICE_SOURCE_ID,
  });
}

/** Network and Diagram present passenger Lines. Infrastructure continues to
 * render physical and per-Service geometry through the existing projector. */
export function usesPassengerLineScene(viewMode: RenderViewOptions['viewMode']): boolean {
  return viewMode === 'network' || viewMode === 'diagram';
}

/** Temporary schema-v16 host bridge. It derives the network query from the
 * current camera and filters, while the pure Line scene remains provider-free. */
export async function projectSchemaV16LineScene(
  options: ProjectSchemaV16LineSceneOptions,
): Promise<ResolvedLineScene> {
  const query = queryFor(options.view);
  return resolveSchemaV16LineScene({
    system: options.system,
    layout: options.layout ?? 'authored',
    query,
    presentation: options.view.presentation,
    sceneRevision: options.sceneRevision,
    signal: options.signal,
  });
}

export function lineSceneFeatures(scene: ResolvedLineScene): FeatureCollection<LineString> {
  const features = scene.scene.featuresBySource.get(SERVICE_SOURCE_ID);
  if (!features) throw new Error('Resolved Line scene is missing the services source.');
  return features as FeatureCollection<LineString>;
}
