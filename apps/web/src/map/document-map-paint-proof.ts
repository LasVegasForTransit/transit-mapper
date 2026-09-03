import type { DocumentMapSceneAccepted, DocumentMapSession } from '@transitmapper/map/driver';
import { SRC_STATIONS } from '@transitmapper/renderer/layers';
import { markFirstSystemMapPaint } from '../perf/mapPaintMark';

interface DocumentMapPaintProofOptions {
  readonly session: DocumentMapSession;
  readonly currentDocumentId: () => string | null;
  readonly onSceneAccepted?: (event: DocumentMapSceneAccepted) => void;
  readonly markPaint?: () => void;
}

export function attachDocumentMapPaintProof({
  session,
  currentDocumentId,
  onSceneAccepted,
  markPaint = markFirstSystemMapPaint,
}: DocumentMapPaintProofOptions): () => void {
  let acceptedDocumentId: string | null = null;
  const unsubscribe = session.subscribeAcceptedScene((event) => {
    onSceneAccepted?.(event);
    if (event.snapshot.status === 'ready' && event.snapshot.system.id === currentDocumentId()) {
      acceptedDocumentId = event.snapshot.system.id;
      session.map.triggerRepaint();
    }
  });
  const onRender = () => {
    const sourceId = session.renderer.activeSourceId(SRC_STATIONS);
    if (
      acceptedDocumentId === null ||
      acceptedDocumentId !== currentDocumentId() ||
      !session.map.getSource(sourceId) ||
      !session.map.isSourceLoaded(sourceId)
    ) {
      return;
    }
    session.map.off('render', onRender);
    markPaint();
  };
  session.map.on('render', onRender);
  return () => {
    unsubscribe();
    session.map.off('render', onRender);
  };
}
