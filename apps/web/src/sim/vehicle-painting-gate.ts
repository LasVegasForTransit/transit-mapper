import type { VehicleGate } from './vehicle-animation-gate';

export interface VehiclePaintingSuspension {
  isSuspended(): boolean;
  subscribe(listener: () => void): () => void;
}

/** Adds a document-rendering suspension without teaching the simulation host
 * about the renderer that owns that state. */
export function withVehiclePaintingSuspension(
  gate: VehicleGate,
  suspension: VehiclePaintingSuspension,
): VehicleGate {
  return {
    isVisible: (service) => gate.isVisible(service),
    viewMode: () => gate.viewMode(),
    pinnedPeriod: () => gate.pinnedPeriod(),
    isDirectManipulationActive: () => gate.isDirectManipulationActive(),
    isPaintingSuspended: () => gate.isPaintingSuspended() || suspension.isSuspended(),
    subscribe(listener) {
      const unsubscribeGate = gate.subscribe(listener);
      const unsubscribeSuspension = suspension.subscribe(listener);
      return () => {
        unsubscribeGate();
        unsubscribeSuspension();
      };
    },
  };
}
