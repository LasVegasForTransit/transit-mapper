import type { MapFeatureReferenceV1 } from '@transitmapper/core/presentation/map-presentation-state';

export interface SelectionController {
  getSnapshot(): MapFeatureReferenceV1 | undefined;
  select(reference: MapFeatureReferenceV1 | undefined): void;
  subscribe(listener: (reference: MapFeatureReferenceV1 | undefined) => void): () => void;
}

function freezeReference(reference: MapFeatureReferenceV1): MapFeatureReferenceV1 {
  return Object.freeze({
    source: reference.source,
    kind: reference.kind,
    id: reference.id,
  });
}

function referencesEqual(
  left: MapFeatureReferenceV1 | undefined,
  right: MapFeatureReferenceV1 | undefined,
): boolean {
  return (
    left === right ||
    (left?.source === right?.source && left?.kind === right?.kind && left?.id === right?.id)
  );
}

export function createSelectionController(initial?: MapFeatureReferenceV1): SelectionController {
  let current = initial === undefined ? undefined : freezeReference(initial);
  const listeners = new Set<(reference: MapFeatureReferenceV1 | undefined) => void>();

  return {
    getSnapshot: () => current,
    select(reference) {
      if (referencesEqual(current, reference)) return;
      current = reference === undefined ? undefined : freezeReference(reference);
      for (const listener of listeners) listener(current);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
