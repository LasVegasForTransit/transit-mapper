import { useEffect, useState } from 'react';
import type { TransitSystem } from '@transitmapper/core/model/system';
import { createMapViewStore, createSelectionController } from '@transitmapper/map';
import { documentMapFeatureDetails } from '@transitmapper/renderer/driver';
import type { RouteHostProps } from '../app/app-root';
import { createDocumentPresentationState } from '../editor/document-view-adapter';
import { attachViewLink, copyViewLink } from '../views/view-link';
import { resolveSharedSystemSession, type SharedSystemSession } from './shared-system-session';
import { ViewerMapSurface } from './viewer-map-surface';
import { ViewerWorkspace, type ViewerMapRenderer, type ViewerStatus } from './viewer-workspace';
import '../ui/app.css';
import '@transitmapper/workspace/workbench.css';
import './viewer.css';

export type ViewerSessionResolver = typeof resolveSharedSystemSession;

export interface ViewerApplicationProps extends RouteHostProps {
  resolveSession?: ViewerSessionResolver;
  fragmentValue?: string;
  renderMap?: ViewerMapRenderer;
  onFork?: (system: TransitSystem) => void;
  onCopyLink?: () => void;
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

const renderDocumentMap: ViewerMapRenderer = (options) => <ViewerMapSurface {...options} />;

export function ViewerApplication({
  routeIntent,
  resolveSession = resolveSharedSystemSession,
  fragmentValue = currentFragmentValue(),
  renderMap = renderDocumentMap,
  onFork = (system) => void forkIntoEditor(system),
  onCopyLink = copyCurrentLink,
}: ViewerApplicationProps) {
  const [viewStore] = useState(() => createMapViewStore(createDocumentPresentationState()));
  const [selection] = useState(() => createSelectionController());
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [mapFailed, setMapFailed] = useState(false);
  const [session, setSession] = useState<SharedSystemSession | null>(null);

  useEffect(() => {
    if (routeIntent.kind !== 'shared-system') {
      setStatus('error');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    setMapFailed(false);
    void resolveSession(routeIntent.shareId, fragmentValue, controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        viewStore.replace(next.state);
        const selectedDetails = next.state.selection
          ? documentMapFeatureDetails(
              { status: 'ready', system: next.system },
              next.state.selection,
            )
          : null;
        selection.select(selectedDetails?.reference);
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
      viewStore={viewStore}
      selection={selection}
      mapFailed={mapFailed}
      renderMap={renderMap}
      onMapError={() => setMapFailed(true)}
      onFork={onFork}
      onCopyLink={onCopyLink}
    />
  );
}

export default ViewerApplication;
