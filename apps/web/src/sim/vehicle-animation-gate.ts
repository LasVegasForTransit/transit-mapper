import type { Service } from '@transitmapper/core/model/system';

/** Presentation state that controls whether and how vehicles are drawn. */
export interface VehicleGate {
  /** Whether this service's vehicles should render under the mode filter. */
  isVisible: (service: Service) => boolean;
  /** Network draws dots, Infrastructure draws footprints, Diagram draws none. */
  viewMode: () => 'network' | 'infrastructure' | 'diagram';
  /** A pinned schedule period, or undefined to follow the simulated clock. */
  pinnedPeriod: () => string | undefined;
  /** True while map geometry or the camera is being manipulated directly.
   * The host keeps painting against the last settled system until release. */
  isDirectManipulationActive: () => boolean;
  /** True while another map covers the editor and owns the visible WebGL work. */
  isPaintingSuspended: () => boolean;
  /** Notify the host when any gate value changes. */
  subscribe: (listener: () => void) => () => void;
}

/** The React-owned values the imperative host reads on each vehicle frame. */
export interface VehicleGateView {
  visibleModes: ReadonlySet<Service['modeId']>;
  viewMode: ReturnType<VehicleGate['viewMode']>;
}

/** Keeps React state current without making the MapLibre host depend on React. */
export interface VehicleAnimationGateController {
  update: (pinnedPeriod: string | undefined, paintingSuspended: boolean) => void;
  notify: () => void;
  createGate: (isDirectManipulationActive: () => boolean) => VehicleGate;
}

export function createVehicleAnimationGateController(
  readView: () => VehicleGateView,
): VehicleAnimationGateController {
  let pinnedPeriod: string | undefined;
  let paintingSuspended = false;
  const listeners = new Set<() => void>();

  return {
    update(nextPinnedPeriod, nextPaintingSuspended) {
      pinnedPeriod = nextPinnedPeriod;
      paintingSuspended = nextPaintingSuspended;
    },
    notify() {
      for (const listener of listeners) listener();
    },
    createGate(isDirectManipulationActive) {
      return {
        isVisible: (service) => readView().visibleModes.has(service.modeId),
        viewMode: () => readView().viewMode,
        pinnedPeriod: () => pinnedPeriod,
        isDirectManipulationActive,
        isPaintingSuspended: () => paintingSuspended,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
    },
  };
}
