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
