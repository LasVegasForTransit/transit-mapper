import {
  MAP_VIEW_SCHEMA_VERSION,
  type MapCameraStateV1,
  type MapFilterValue,
  type MapPresentationStateV1,
  type RepresentationId,
} from '@transitmapper/core/presentation/map-presentation-state';

export type MapViewStoreListener = (state: MapPresentationStateV1) => void;

export interface MapViewStore {
  getSnapshot(): MapPresentationStateV1;
  replace(next: MapPresentationStateV1): void;
  setCamera(camera: MapCameraStateV1): void;
  setRepresentationId(representationId: RepresentationId): void;
  setFilter(id: string, value: MapFilterValue): void;
  subscribe(listener: MapViewStoreListener): () => void;
}

function freezeFilterValue(value: MapFilterValue): MapFilterValue {
  if (typeof value === 'boolean' || typeof value === 'string') return value;
  return Object.freeze(value.map((item) => item));
}

function freezeCamera(camera: MapCameraStateV1): MapCameraStateV1 {
  const center = Object.freeze([camera.center[0], camera.center[1]]) as unknown as [number, number];
  return Object.freeze({ center, zoom: camera.zoom });
}

function freezeFilters(
  input: Readonly<Record<string, MapFilterValue>>,
): Record<string, MapFilterValue> {
  return Object.freeze(
    Object.fromEntries(Object.entries(input).map(([id, value]) => [id, freezeFilterValue(value)])),
  );
}

function freezeState(state: MapPresentationStateV1): MapPresentationStateV1 {
  return Object.freeze({
    schemaVersion: MAP_VIEW_SCHEMA_VERSION,
    camera: freezeCamera(state.camera),
    representationId: state.representationId,
    filters: freezeFilters(state.filters),
  });
}

function filterValuesEqual(left: MapFilterValue, right: MapFilterValue): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return left === right;
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function statesEqual(left: MapPresentationStateV1, right: MapPresentationStateV1): boolean {
  if (
    left.representationId !== right.representationId ||
    left.camera.zoom !== right.camera.zoom ||
    left.camera.center[0] !== right.camera.center[0] ||
    left.camera.center[1] !== right.camera.center[1]
  ) {
    return false;
  }
  const leftIds = Object.keys(left.filters);
  const rightIds = Object.keys(right.filters);
  return (
    leftIds.length === rightIds.length &&
    leftIds.every(
      (id) => id in right.filters && filterValuesEqual(left.filters[id], right.filters[id]),
    )
  );
}

export function createMapViewStore(initialState: MapPresentationStateV1): MapViewStore {
  let current = freezeState(initialState);
  const listeners = new Set<MapViewStoreListener>();

  function publish(next: MapPresentationStateV1): void {
    current = next;
    for (const listener of listeners) listener(current);
  }

  return {
    getSnapshot: () => current,
    replace(next) {
      const frozen = freezeState(next);
      if (!statesEqual(current, frozen)) publish(frozen);
    },
    setCamera(camera) {
      if (
        current.camera.zoom === camera.zoom &&
        current.camera.center[0] === camera.center[0] &&
        current.camera.center[1] === camera.center[1]
      ) {
        return;
      }
      publish(Object.freeze({ ...current, camera: freezeCamera(camera) }));
    },
    setRepresentationId(representationId) {
      if (current.representationId === representationId) return;
      publish(Object.freeze({ ...current, representationId }));
    },
    setFilter(id, value) {
      if (Object.hasOwn(current.filters, id) && filterValuesEqual(current.filters[id], value)) {
        return;
      }
      publish(
        Object.freeze({
          ...current,
          filters: Object.freeze({ ...current.filters, [id]: freezeFilterValue(value) }),
        }),
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
