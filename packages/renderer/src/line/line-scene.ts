import type { FeatureCollection, LineString } from 'geojson';
import type { TransitSystem } from '@transitmapper/core/model/system';
import type { NetworkQuery } from '@transitmapper/core/network/query';
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
}

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

async function resolveSchemaV16LineScene(
  system: TransitSystem,
  query: NetworkQuery,
  presentation: RenderPresentation,
  sceneRevision: string,
): Promise<ResolvedLineScene> {
  const provider = createSchemaV16SystemProvider(system);
  const descriptor = await provider.describe({
    kind: 'transit-system',
    id: system.id,
    revision: { kind: 'latest' },
  });
  const result = await provider.resolve(descriptor.content, query);
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
  return resolveSchemaV16LineScene(
    options.system,
    query,
    options.view.presentation,
    options.sceneRevision,
  );
}

export function lineSceneFeatures(scene: ResolvedLineScene): FeatureCollection<LineString> {
  const features = scene.scene.featuresBySource.get(SERVICE_SOURCE_ID);
  if (!features) throw new Error('Resolved Line scene is missing the services source.');
  return features as FeatureCollection<LineString>;
}
