import type { TransitSystem } from '@transitmapper/core/model/system';
import type { GetViewResponse, MapViewStateV1 } from '@transitmapper/views';
import type { RouteIntent } from '../app/route-intent';
import { fetchShare } from '../share/api';
import { fetchPublishedView } from '../views/api';
import { resolveDocumentViewState, resolveSharedSystemSession } from './shared-system-session';

export interface ViewerSessionSources {
  fetchSharedSystem(id: string, options: { signal: AbortSignal }): Promise<TransitSystem>;
  fetchPublishedView(id: string, options: { signal: AbortSignal }): Promise<GetViewResponse>;
}

export interface ViewerSession {
  system: TransitSystem;
  state: MapViewStateV1;
  title?: string;
}

const browserSources: ViewerSessionSources = {
  fetchSharedSystem: fetchShare,
  fetchPublishedView,
};

export async function resolveViewerSession(
  routeIntent: Exclude<RouteIntent, { kind: 'editor' }>,
  fragmentValue: string | undefined,
  signal: AbortSignal,
  sources: ViewerSessionSources = browserSources,
): Promise<ViewerSession> {
  if (routeIntent.kind === 'shared-system') {
    return resolveSharedSystemSession(routeIntent.shareId, fragmentValue, signal, sources);
  }

  const published = await sources.fetchPublishedView(routeIntent.viewId, { signal });
  const system = await sources.fetchSharedSystem(published.view.map.id, { signal });
  return {
    system,
    title: published.view.title,
    state: resolveDocumentViewState(system, published.view.state, fragmentValue),
  };
}
