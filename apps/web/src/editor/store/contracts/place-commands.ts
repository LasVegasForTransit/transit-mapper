import type { LngLat, StopAnchor } from '@transitmapper/core/model/system';

interface SetStopNameOptions {
  auto?: boolean;
}

export interface StopCommands {
  readonly addStop: (coord: LngLat, anchor?: StopAnchor) => string | null;
  readonly consumeFocusName: (id: string) => void;
  readonly moveStop: (id: string, coord: LngLat, anchor?: StopAnchor) => void;
  readonly setStopName: (id: string, name: string, options?: SetStopNameOptions) => void;
  readonly suggestStopName: (id: string) => void;
  readonly setStopDwellSeconds: (id: string, seconds: number | undefined) => void;
  readonly setStopMajorStop: (id: string, major: boolean) => void;
  readonly deleteStop: (id: string) => void;
}

export interface StationCommands {
  readonly addDrawnStation: (footprint: LngLat[]) => string | null;
  readonly setStationName: (id: string, name: string) => void;
  readonly deleteStation: (id: string) => void;
  readonly addStationFootprint: (id: string) => void;
  readonly moveFootprintPoint: (id: string, index: number, coord: LngLat) => void;
  readonly deleteStationFootprint: (id: string) => void;
  readonly addPlatform: (id: string) => string | null;
  readonly movePlatformPoint: (
    id: string,
    platformId: string,
    index: number,
    coord: LngLat,
  ) => void;
  readonly deletePlatform: (id: string, platformId: string) => void;
  readonly attachStop: (stationId: string, stopId: string) => void;
  readonly detachStop: (stopId: string) => void;
}

export interface FacilityCommands {
  readonly addFacility: (typeId: string, geometry: LngLat | LngLat[]) => string | null;
  readonly moveFacility: (id: string, geometry: LngLat) => void;
  readonly setFacilityName: (id: string, name: string) => void;
  readonly deleteFacility: (id: string) => void;
}

export interface GroupCommands {
  readonly createGroup: (memberIds: string[], name?: string) => string | null;
  readonly addGroupMember: (groupId: string, memberId: string) => void;
  readonly removeGroupMember: (groupId: string, memberId: string) => void;
  readonly renameGroup: (id: string, name: string) => void;
  readonly setGroupColor: (id: string, color: string) => void;
  readonly deleteGroup: (id: string) => void;
  readonly createFacilityComplex: (footprint: LngLat[]) => string | null;
  readonly addGroupFootprint: (groupId: string) => void;
  readonly moveGroupFootprintPoint: (groupId: string, index: number, coord: LngLat) => void;
  readonly deleteGroupFootprint: (groupId: string) => void;
  readonly startPlacingFacility: (groupId: string) => void;
  readonly cancelPlacingFacility: () => void;
  readonly placeFacilityInGroup: (groupId: string, typeId: string, coord: LngLat) => string | null;
  readonly startPickingMember: (groupId: string) => void;
  readonly cancelPickingMember: () => void;
}
