import type { TransitSystem } from '@transitmapper/core/model/system';

interface VehicleStoreSnapshot {
  system: TransitSystem;
}

/** Narrow read-only editor port consumed by the vehicle animation host. */
export interface VehicleAnimationStore {
  readonly getState: () => VehicleStoreSnapshot;
  readonly subscribe: (
    listener: (state: VehicleStoreSnapshot, previous: VehicleStoreSnapshot) => void,
  ) => () => void;
}
