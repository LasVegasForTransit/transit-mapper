import type { RunDirection } from '@transitmapper/core/model/system';
import type { PatternPosition } from '@transitmapper/core/model/serviceEdits';
import type {
  TerminusGesturePlan,
  TerminusGestureSource,
  TerminusGestureTarget,
} from '@transitmapper/core/model/serviceGestures';
import type { RouteSpan } from '@transitmapper/core/model/routeGraph';
import type { SchedulePeriod, VehicleKind } from '@transitmapper/core/model/system';

interface AddServiceToLineDetails {
  name: string;
  modeId: string;
}

export interface ServiceCommands {
  readonly addServiceToWay: (wayId: string) => string | null;
  readonly setLineName: (id: string, name: string) => void;
  readonly setLineColor: (id: string, color: string) => void;
  readonly deleteLine: (id: string) => void;
  readonly setServiceName: (id: string, name: string) => void;
  readonly setServiceMode: (id: string, modeId: string) => void;
  readonly setServiceFrequency: (id: string, minutes: number | undefined) => void;
  readonly setServiceSpan: (id: string, start: string | undefined, end: string | undefined) => void;
  readonly setServiceSchedule: (id: string, periods: SchedulePeriod[] | undefined) => void;
  readonly setVehicleKinds: (kinds: VehicleKind[]) => void;
  readonly setServiceVehicleKind: (id: string, vehicleKindId: string | undefined) => void;
  readonly deleteService: (id: string) => void;
  readonly startAddingServiceToLine: (lineId: string, details: AddServiceToLineDetails) => void;
  readonly cancelAddingService: () => void;
  readonly moveServiceToLine: (serviceId: string, lineId: string) => void;
  readonly moveServicesToLine: (serviceIds: readonly string[], lineId: string) => void;
  readonly throughRouteInto: (keepId: string, otherId: string) => boolean;
  readonly trimPatternTo: (
    ...args: [serviceId: string, patternId: string, wayId: string, t: number, side: 'start' | 'end']
  ) => boolean;
  readonly trimPatternAt: (
    serviceId: string,
    position: PatternPosition,
    side: 'start' | 'end',
  ) => boolean;
  readonly extendPatternTerminus: (
    serviceId: string,
    patternId: string,
    side: 'start' | 'end',
    spans: RouteSpan[],
  ) => boolean;
  readonly commitTerminusGesture: (
    source: TerminusGestureSource,
    target: TerminusGestureTarget,
    plan: TerminusGesturePlan,
    choice?: 'connect' | 'through',
  ) => boolean;
  readonly endPatternAt: (serviceId: string, position: PatternPosition) => boolean;
  readonly divideServiceAt: (serviceId: string, position: PatternPosition) => string | null;
  readonly splitServiceAt: (
    serviceId: string,
    patternId: string,
    wayId: string,
    t: number,
  ) => string | null;
  readonly setStopSkipped: (
    ...args: [
      serviceId: string,
      patternId: string,
      run: RunDirection,
      stationId: string,
      skipped: boolean,
    ]
  ) => void;
  readonly makePatternTwoWay: (serviceId: string, patternId: string) => void;
}
