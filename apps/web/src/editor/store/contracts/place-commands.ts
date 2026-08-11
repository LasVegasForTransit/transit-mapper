import type { LngLat, StationAnchor } from '@transitmapper/core/model/system';

interface SetStationNameOptions {
  auto?: boolean;
}

export interface StationCommands {
  readonly addStation: (coord: LngLat, anchor?: StationAnchor) => string | null;
  readonly addDrawnStation: (footprint: LngLat[]) => string | null;
  readonly consumeFocusName: (id: string) => void;
  readonly moveStation: (id: string, coord: LngLat, anchor?: StationAnchor) => void;
  readonly setStationName: (id: string, name: string, options?: SetStationNameOptions) => void;
  readonly suggestStationName: (id: string) => void;
  readonly setStationDwellSeconds: (id: string, seconds: number | undefined) => void;
  readonly setStationMajorStop: (id: string, major: boolean) => void;
  readonly deleteStation: (id: string) => void;
  readonly addStationFootprint: (stationId: string) => void;
  readonly moveFootprintPoint: (stationId: string, index: number, coord: LngLat) => void;
  readonly deleteStationFootprint: (stationId: string) => void;
  readonly addPlatform: (stationId: string) => string | null;
  readonly movePlatformPoint: (
    stationId: string,
    platformId: string,
    index: number,
    coord: LngLat,
  ) => void;
  readonly deletePlatform: (stationId: string, platformId: string) => void;
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
