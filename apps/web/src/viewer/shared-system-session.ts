import type { TransitSystem } from '@transitmapper/core/model/system';
import { resolveMapPresentationState } from '@transitmapper/map/state';
import { decodeMapViewState, type MapViewStateV1, ViewParseError } from '@transitmapper/views';
import { DOCUMENT_MAP_DEFINITION } from '../editor/document-map-definition';
import { createDocumentPresentationState } from '../editor/document-view-adapter';
import { fetchShare } from '../share/api';

export interface SharedSystemSessionSources {
  fetchSharedSystem(id: string, options: { signal: AbortSignal }): Promise<TransitSystem>;
}

export interface SharedSystemSession {
  system: TransitSystem;
  state: MapViewStateV1;
}

const browserSources: SharedSystemSessionSources = { fetchSharedSystem: fetchShare };

function resolvedViewState(system: TransitSystem, fragmentValue?: string): MapViewStateV1 {
  const fallback = createDocumentPresentationState({ camera: system.viewport });
  if (fragmentValue === undefined) return fallback;
  try {
    const decoded = decodeMapViewState(fragmentValue);
    const presentation = resolveMapPresentationState(DOCUMENT_MAP_DEFINITION, decoded);
    return decoded.selection === undefined
      ? presentation
      : { ...presentation, selection: decoded.selection };
  } catch (error) {
    if (error instanceof ViewParseError) return fallback;
    throw error;
  }
}

export async function resolveSharedSystemSession(
  shareId: string,
  fragmentValue: string | undefined,
  signal: AbortSignal,
  sources: SharedSystemSessionSources = browserSources,
): Promise<SharedSystemSession> {
  const system = await sources.fetchSharedSystem(shareId, { signal });
  return { system, state: resolvedViewState(system, fragmentValue) };
}
