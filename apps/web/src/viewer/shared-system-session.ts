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

export function resolveDocumentViewState(
  system: TransitSystem,
  baseState: MapViewStateV1 = createDocumentPresentationState({ camera: system.viewport }),
  fragmentValue?: string,
): MapViewStateV1 {
  const fallback = resolveMapPresentationState(DOCUMENT_MAP_DEFINITION, baseState);
  const resolvedFallback =
    baseState.selection === undefined ? fallback : { ...fallback, selection: baseState.selection };
  if (fragmentValue === undefined) return resolvedFallback;
  try {
    const decoded = decodeMapViewState(fragmentValue);
    const presentation = resolveMapPresentationState(DOCUMENT_MAP_DEFINITION, decoded);
    return decoded.selection === undefined
      ? presentation
      : { ...presentation, selection: decoded.selection };
  } catch (error) {
    if (error instanceof ViewParseError) return resolvedFallback;
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
  return { system, state: resolveDocumentViewState(system, undefined, fragmentValue) };
}
