import { squareFootprint } from '@transitmapper/core/model/geo';
import { shortId } from '@transitmapper/core/model/ids';
import { deleteSelection } from '@transitmapper/core/model/selection-deletion';
import type { LngLat, Platform, Station } from '@transitmapper/core/model/system';
import type { StationCommands } from '../contracts/place-commands';
import type { EditorRuntime } from '../runtime';

const FOOTPRINT_HALF_SIZE_M = 30;
const PLATFORM_HALF_SIZE_M = 12;

function stationCenter(footprint: LngLat[]): LngLat {
  return [
    footprint.reduce((sum, point) => sum + point[0], 0) / footprint.length,
    footprint.reduce((sum, point) => sum + point[1], 0) / footprint.length,
  ];
}

type UpdateStation = (id: string, update: (station: Station) => Station) => void;

function stationUpdater(runtime: EditorRuntime): UpdateStation {
  return (id, update) =>
    runtime.commitContent(undefined, ({ system }) => {
      const index = system.stations.findIndex((station) => station.id === id);
      if (index < 0) return { system, result: undefined };
      const current = system.stations[index];
      const station = update(current);
      if (station === current) return { system, result: undefined };
      const stations = [...system.stations];
      stations[index] = station;
      return { system: { ...system, stations }, result: undefined };
    });
}

function addDrawnStation(runtime: EditorRuntime, footprint: LngLat[]): string | null {
  return runtime.commitContent(null, ({ system }) => {
    if (footprint.length === 0) return { system, result: null };
    const station: Station = {
      id: shortId(),
      coord: stationCenter(footprint),
      footprint,
    };
    return {
      system: { ...system, stations: [...system.stations, station] },
      transient: { selection: { kind: 'station' as const, id: station.id } },
      result: station.id,
    };
  });
}

function addPlatform(runtime: EditorRuntime, id: string): string | null {
  return runtime.commitContent(null, ({ system }) => {
    const index = system.stations.findIndex((station) => station.id === id);
    if (index < 0) return { system, result: null };
    const platform: Platform = {
      id: shortId(),
      points: squareFootprint(system.stations[index].coord, PLATFORM_HALF_SIZE_M),
      edges: 1,
    };
    const stations = [...system.stations];
    stations[index] = {
      ...stations[index],
      platforms: [...(stations[index].platforms ?? []), platform],
    };
    return { system: { ...system, stations }, result: platform.id };
  });
}

function setStopStation(runtime: EditorRuntime, stopId: string, stationId?: string): void {
  runtime.commitContent(undefined, ({ system }) => {
    if (stationId && !system.stations.some((station) => station.id === stationId)) {
      return { system, result: undefined };
    }
    const stops = system.stops.map((stop) =>
      stop.id === stopId && stop.stationId !== stationId ? { ...stop, stationId } : stop,
    );
    return {
      system: stops.every((stop, index) => stop === system.stops[index])
        ? system
        : { ...system, stops },
      result: undefined,
    };
  });
}

export function createStationCommands(runtime: EditorRuntime): StationCommands {
  const updateStation = stationUpdater(runtime);

  return {
    addDrawnStation: (footprint) => addDrawnStation(runtime, footprint),
    setStationName: (id, name) =>
      updateStation(id, (station) =>
        station.name === name ? station : { ...station, name: name || undefined },
      ),
    deleteStation: (id) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: deleteSelection(system, [{ kind: 'station', id }]),
        result: undefined,
      })),
    addStationFootprint: (id) =>
      updateStation(id, (station) =>
        station.footprint
          ? station
          : { ...station, footprint: squareFootprint(station.coord, FOOTPRINT_HALF_SIZE_M) },
      ),
    moveFootprintPoint: (id, index, coord) =>
      updateStation(id, (station) => {
        if (!station.footprint?.[index]) return station;
        return {
          ...station,
          footprint: station.footprint.map((point, pointIndex) =>
            pointIndex === index ? coord : point,
          ),
        };
      }),
    deleteStationFootprint: (id) =>
      updateStation(id, (station) =>
        station.footprint || station.platforms
          ? { ...station, footprint: undefined, platforms: undefined }
          : station,
      ),
    addPlatform: (id) => addPlatform(runtime, id),
    movePlatformPoint: (id, platformId, index, coord) =>
      updateStation(id, (station) => ({
        ...station,
        platforms: station.platforms?.map((platform) =>
          platform.id === platformId
            ? {
                ...platform,
                points: platform.points.map((point, pointIndex) =>
                  pointIndex === index ? coord : point,
                ),
              }
            : platform,
        ),
      })),
    deletePlatform: (id, platformId) =>
      updateStation(id, (station) => ({
        ...station,
        platforms: station.platforms?.filter((platform) => platform.id !== platformId),
      })),
    attachStop: (stationId, stopId) => setStopStation(runtime, stopId, stationId),
    detachStop: (stopId) => setStopStation(runtime, stopId),
  };
}
