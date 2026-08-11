import { suggestStopName } from '@transitmapper/core/model/geo/crossStreetNaming';
import { snap, squareFootprint } from '@transitmapper/core/model/geo';
import { shortId } from '@transitmapper/core/model/ids';
import { deleteSelection } from '@transitmapper/core/model/selection-deletion';
import {
  addStationFootprint,
  addStationPlatform,
  createStation,
  deleteStationFootprint,
  deleteStationPlatform,
  moveStation,
  moveStationFootprintPoint,
  moveStationPlatformPoint,
  setStationDwellSeconds,
  setStationMajorStop,
  setStationName,
  withSuggestedStationName,
} from '@transitmapper/core/model/system';
import type { LngLat, Platform, Station, StationAnchor } from '@transitmapper/core/model/system';
import type { StationCommands } from '../contracts/place-commands';
import type { EditorRuntime } from '../runtime';

const FOOTPRINT_HALF_SIZE_M = 30;
const STATION_DRAW_ANCHOR_M = 60;
const PLATFORM_HALF_SIZE_M = 12;

function addStation(runtime: EditorRuntime, coord: LngLat, anchor?: StationAnchor): string | null {
  return runtime.commitContent(null, (state) => {
    const { system } = state;
    const bare = createStation(coord, anchor);
    const suggestion = suggestStopName({ system, coord, anchors: bare.anchors });
    const station = withSuggestedStationName(bare, suggestion.name);
    return {
      system: { ...system, stations: [...system.stations, station] },
      transient: {
        selection: { kind: 'station', id: station.id },
        focusNameToken: state.focusNameToken + 1,
        focusNameStationId: station.id,
      },
      result: station.id,
    };
  });
}

function addDrawnStation(runtime: EditorRuntime, footprint: LngLat[]): string | null {
  return runtime.commitContent(null, ({ system }) => {
    if (footprint.length === 0) return { system, result: null };
    const center: LngLat = [
      footprint.reduce((sum, point) => sum + point[0], 0) / footprint.length,
      footprint.reduce((sum, point) => sum + point[1], 0) / footprint.length,
    ];
    const hit = snap(system.ways, center, STATION_DRAW_ANCHOR_M);
    const coord = hit?.coord ?? center;
    const anchors = hit ? [{ wayId: hit.wayId, t: hit.t }] : [];
    const suggestion = suggestStopName({ system, coord, anchors });
    const station = withSuggestedStationName<Station>(
      { id: shortId(), coord, anchors, footprint },
      suggestion.name,
    );
    return {
      system: { ...system, stations: [...system.stations, station] },
      transient: { selection: { kind: 'station', id: station.id } },
      result: station.id,
    };
  });
}

function addPlatform(runtime: EditorRuntime, stationId: string): string | null {
  return runtime.commitContent(null, ({ system }) => {
    const station = system.stations.find((candidate) => candidate.id === stationId);
    if (!station) return { system, result: null };
    const platform: Platform = {
      id: shortId(),
      points: squareFootprint(station.coord, PLATFORM_HALF_SIZE_M),
      edges: 1,
    };
    const next = addStationPlatform(system, stationId, platform);
    return { system: next, result: platform.id };
  });
}

type StationLifecycleCommands = Pick<
  StationCommands,
  'addStation' | 'addDrawnStation' | 'consumeFocusName' | 'moveStation' | 'deleteStation'
>;

function createStationLifecycleCommands(runtime: EditorRuntime): StationLifecycleCommands {
  return {
    addStation: (coord, anchor) => addStation(runtime, coord, anchor),
    addDrawnStation: (footprint) => addDrawnStation(runtime, footprint),
    consumeFocusName(id) {
      if (runtime.read().focusNameStationId !== id) return;
      runtime.updateTransient({ focusNameStationId: null });
    },
    moveStation: (id, coord, anchor) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: moveStation(system, id, coord, anchor),
        result: undefined,
      })),
    deleteStation: (id) =>
      runtime.commitContent(undefined, (state) => {
        const system = deleteSelection(state.system, [{ kind: 'station', id }]);
        if (system === state.system) {
          return { system: state.system, result: undefined };
        }
        return {
          system,
          transient: {
            selection:
              state.selection?.kind === 'station' && state.selection.id === id
                ? null
                : state.selection,
          },
          result: undefined,
        };
      }),
  };
}

type StationMetadataCommands = Pick<
  StationCommands,
  'setStationName' | 'suggestStationName' | 'setStationDwellSeconds' | 'setStationMajorStop'
>;

function createStationMetadataCommands(runtime: EditorRuntime): StationMetadataCommands {
  return {
    setStationName: (id, name, options) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: setStationName(system, id, name, options?.auto ?? false),
        result: undefined,
      })),
    suggestStationName(id) {
      runtime.commitContent(undefined, ({ system }) => {
        const station = system.stations.find((candidate) => candidate.id === id);
        if (!station) return { system, result: undefined };
        const suggestion = suggestStopName({
          system,
          coord: station.coord,
          anchors: station.anchors,
        });
        const name = suggestion.name;
        const next = name ? setStationName(system, id, name, true) : system;
        return { system: next, result: undefined };
      });
    },
    setStationDwellSeconds: (id, seconds) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: setStationDwellSeconds(system, id, seconds),
        result: undefined,
      })),
    setStationMajorStop: (id, major) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: setStationMajorStop(system, id, major),
        result: undefined,
      })),
  };
}

type StationGeometryCommands = Pick<
  StationCommands,
  | 'addStationFootprint'
  | 'moveFootprintPoint'
  | 'deleteStationFootprint'
  | 'addPlatform'
  | 'movePlatformPoint'
  | 'deletePlatform'
>;

function createStationGeometryCommands(runtime: EditorRuntime): StationGeometryCommands {
  return {
    addStationFootprint: (stationId) =>
      runtime.commitContent(undefined, ({ system }) => {
        const station = system.stations.find((candidate) => candidate.id === stationId);
        const next =
          station && !station.footprint
            ? addStationFootprint(
                system,
                stationId,
                squareFootprint(station.coord, FOOTPRINT_HALF_SIZE_M),
              )
            : system;
        return { system: next, result: undefined };
      }),
    moveFootprintPoint: (stationId, index, coord) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: moveStationFootprintPoint(system, stationId, index, coord),
        result: undefined,
      })),
    deleteStationFootprint: (stationId) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: deleteStationFootprint(system, stationId),
        result: undefined,
      })),
    addPlatform: (stationId) => addPlatform(runtime, stationId),
    movePlatformPoint: (stationId, platformId, index, coord) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: moveStationPlatformPoint(system, { stationId, platformId, index, coord }),
        result: undefined,
      })),
    deletePlatform: (stationId, platformId) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: deleteStationPlatform(system, stationId, platformId),
        result: undefined,
      })),
  };
}

/** Creates the station command surface once for one editor runtime. */
export function createStationCommands(runtime: EditorRuntime): StationCommands {
  return {
    ...createStationLifecycleCommands(runtime),
    ...createStationMetadataCommands(runtime),
    ...createStationGeometryCommands(runtime),
  };
}
