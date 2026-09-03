import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { createMapViewStore, createSelectionController } from '@transitmapper/map/state';
import { createDocumentPresentationState } from '@transitmapper/map/presentation';
import type { RouteHostProps } from '../app/route-host';
import { SHELL_MOUNTED_MARK, markOnce } from '../perf/startup-marks';
import { attachViewLink, copyViewLink } from '../views/view-link';
import { resolveViewerSession, type ViewerSession } from './viewer-session';
import {
  ViewerWorkspace,
  type ViewerFeatureDetailsResolver,
  type ViewerMapRenderer,
  type ViewerStatus,
} from './viewer-workspace';
import '../ui/app.css';
import '@transitmapper/workspace/workbench.css';
import './viewer.css';

export type ViewerSessionResolver = typeof resolveViewerSession;

export interface ViewerApplicationProps extends RouteHostProps {
  resolveSession?: ViewerSessionResolver;
  fragmentValue?: string;
  renderMap?: ViewerMapRenderer;
  onFork?: (system: TransitSystem) => void;
  onCopyLink?: () => void;
  resolveFeatureDetails?: ViewerFeatureDetailsResolver;
}

function currentFragmentValue(): string | undefined {
  const prefix = '#view=';
  return window.location.hash.startsWith(prefix)
    ? window.location.hash.slice(prefix.length)
    : undefined;
}

async function forkIntoEditor(system: TransitSystem): Promise<void> {
  const [{ forkSystem }, { saveToLibrary }, { setActiveId }] = await Promise.all([
    import('@transitmapper/core/model/serialize'),
    import('../storage/browserLibrary'),
    import('../storage/localStore'),
  ]);
  const forked = forkSystem(system);
  const outcome = await saveToLibrary(forked);
  if (outcome !== 'saved') throw new Error('The fork could not be saved in this browser.');
  setActiveId(forked.id);
  window.location.assign('/');
}

function copyCurrentLink(): void {
  void copyViewLink();
}

const viewerMapSurfaceModule = import('./viewer-map-surface');
const ViewerMapSurface = lazy(() => viewerMapSurfaceModule);

const renderDocumentMap: ViewerMapRenderer = (options) => (
  <Suspense fallback={<div className="workspace-map-surface" role="region" aria-label="Map" />}>
    <ViewerMapSurface {...options} />
  </Suspense>
);

export function ViewerApplication({
  routeIntent,
  resolveSession = resolveViewerSession,
  fragmentValue = currentFragmentValue(),
  renderMap = renderDocumentMap,
  onFork = (system) => void forkIntoEditor(system),
  onCopyLink = copyCurrentLink,
  resolveFeatureDetails,
}: ViewerApplicationProps) {
  useLayoutEffect(() => {
    markOnce(SHELL_MOUNTED_MARK);
  }, []);
  const [viewStore] = useState(() => createMapViewStore(createDocumentPresentationState()));
  const [selection] = useState(() => createSelectionController());
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [mapFailed, setMapFailed] = useState(false);
  const [session, setSession] = useState<ViewerSession | null>(null);

  useEffect(() => {
    if (routeIntent.kind === 'editor') {
      setStatus('error');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    setMapFailed(false);
    void resolveSession(routeIntent, fragmentValue, controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        viewStore.replace(next.state);
        selection.select(next.state.selection);
        setSession(next);
        setStatus('ready');
      },
      () => {
        if (!controller.signal.aborted) setStatus('error');
      },
    );
    return () => controller.abort();
  }, [fragmentValue, resolveSession, routeIntent, selection, viewStore]);

  useEffect(() => {
    if (status !== 'ready') return;
    return attachViewLink({ viewStore, selection });
  }, [selection, status, viewStore]);

  return (
    <ViewerWorkspace
      status={status}
      system={session?.system ?? null}
      title={session?.title}
      viewStore={viewStore}
      selection={selection}
      mapFailed={mapFailed}
      renderMap={renderMap}
      onMapError={() => setMapFailed(true)}
      onFork={onFork}
      onCopyLink={onCopyLink}
      resolveFeatureDetails={resolveFeatureDetails}
    />
  );
}

export default ViewerApplication;
