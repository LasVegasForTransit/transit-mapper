import type { ServiceCommands } from '../store/contracts/service-commands';
import type { SelectionCommands } from '../store/contracts/tool-selection-commands';
import type { NetworkCommands, WayCommands } from '../store/contracts/way-network-commands';

interface SelectionActionCommandGroups {
  selection: Pick<SelectionCommands, 'armTerminus' | 'deleteMultiSelection'>;
  services: Pick<
    ServiceCommands,
    | 'divideServiceAt'
    | 'endPatternAt'
    | 'makePatternTwoWay'
    | 'moveServiceToLine'
    | 'moveServicesToLine'
    | 'throughRouteInto'
  >;
  ways: Pick<WayCommands, 'splitWayAtT'>;
  network: Pick<
    NetworkCommands,
    'formCrossingJunctions' | 'mergeWays' | 'mergeWaysIntoCorridor' | 'separateCarriageways'
  >;
}

/** The action registry reads one flag and invokes only selection-menu commands. */
export interface SelectionActionStore {
  readonly commands: SelectionActionCommandGroups;
}
