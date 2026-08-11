import type { Grade } from '@transitmapper/core/model/catalog';
import type {
  CrossSection,
  DrivingSide,
  LaneConnector,
  LineGeometry,
  LngLat,
  NodeControl,
} from '@transitmapper/core/model/system';

export interface WayCommands {
  readonly beginOneWayBranch: (fromWayId: string, end: 'start' | 'end') => string | null;
  readonly beginWay: (typeId?: string, geometry?: LineGeometry, color?: string) => string | null;
  readonly resumeWay: (id: string) => void;
  readonly addWayPoint: (wayId: string, coord: LngLat) => void;
  readonly insertWayPoint: (wayId: string, index: number, coord: LngLat) => void;
  readonly moveWayPoint: (wayId: string, index: number, coord: LngLat) => void;
  readonly deleteWayPoint: (wayId: string, index: number) => void;
  readonly joinWayPointToWay: (
    wayId: string,
    index: number,
    targetWayId: string,
    coord: LngLat,
  ) => void;
  readonly closeWayLoop: (wayId: string) => void;
  readonly straightenWay: (wayId: string) => void;
  readonly finishWay: () => void;
  readonly setWayGeometry: (id: string, geometry: LineGeometry) => void;
  readonly setWayGrade: (id: string, grade: Grade) => void;
  readonly setWayClassId: (id: string, classId: string | undefined) => void;
  readonly setWayCapacity: (id: string, capacity: number) => void;
  readonly deleteWay: (id: string) => void;
  readonly splitWayAt: (wayId: string, index: number) => void;
  readonly splitWayAtT: (wayId: string, t: number) => void;
  readonly setWayProfile: (id: string, profile: CrossSection) => void;
  readonly applyProfilePreset: (id: string, presetId: string) => void;
  readonly nameWay: (wayId: string, name: string) => void;
  readonly renameNamedWay: (id: string, name: string) => void;
}

export interface NetworkCommands {
  readonly setNodeControl: (nodeId: string, control: NodeControl | undefined) => void;
  readonly setNodeConnectors: (nodeId: string, connectors: LaneConnector[] | undefined) => void;
  readonly disconnectNodeWay: (nodeId: string, wayId: string) => void;
  readonly setApproachControl: (
    wayId: string,
    end: 'start' | 'end',
    control: NodeControl | undefined,
  ) => void;
  readonly setTurnRestriction: (
    wayId: string,
    laneId: string,
    allowedTargets: string[] | undefined,
  ) => void;
  readonly setDrivingSide: (side: DrivingSide) => void;
  readonly formCrossingJunctions: (wayId: string, onlyWithWayId?: string) => void;
  readonly mergeWays: (keepWayId: string, otherWayId: string) => void;
  readonly separateCarriageways: (wayId: string) => string | null;
  readonly combineCarriageways: (namedWayId: string) => void;
  readonly setMedianWidth: (namedWayId: string, widthM: number | undefined) => void;
  readonly deleteWayStretch: (wayId: string, fromT: number, toT: number) => number;
  readonly mergeWaysIntoCorridor: (wayIds: string[]) => number;
}
