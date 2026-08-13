import { suggestStopName } from '@transitmapper/core/model/geo/crossStreetNaming';
import { deleteSelection } from '@transitmapper/core/model/selection-deletion';
import {
  createStop,
  moveStop,
  setStopDwellSeconds,
  setStopMajorStop,
  setStopName,
  withSuggestedStopName,
} from '@transitmapper/core/model/system';
import type { LngLat, StopAnchor } from '@transitmapper/core/model/system';
import type { StopCommands } from '../contracts/place-commands';
import type { EditorRuntime } from '../runtime';

function addStop(runtime: EditorRuntime, coord: LngLat, anchor?: StopAnchor): string | null {
  return runtime.commitContent(null, (state) => {
    const { system } = state;
    const bare = createStop(coord, anchor);
    const suggestion = suggestStopName({ system, coord, anchors: bare.anchors });
    const stop = withSuggestedStopName(bare, suggestion.name);
    return {
      system: { ...system, stops: [...system.stops, stop] },
      transient: {
        selection: { kind: 'stop', id: stop.id },
        focusNameToken: state.focusNameToken + 1,
        focusNameStopId: stop.id,
      },
      result: stop.id,
    };
  });
}

type StopLifecycleCommands = Pick<
  StopCommands,
  'addStop' | 'consumeFocusName' | 'moveStop' | 'deleteStop'
>;

function createStopLifecycleCommands(runtime: EditorRuntime): StopLifecycleCommands {
  return {
    addStop: (coord, anchor) => addStop(runtime, coord, anchor),
    consumeFocusName(id) {
      if (runtime.read().focusNameStopId !== id) return;
      runtime.updateTransient({ focusNameStopId: null });
    },
    moveStop: (id, coord, anchor) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: moveStop(system, id, coord, anchor),
        result: undefined,
      })),
    deleteStop: (id) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: deleteSelection(system, [{ kind: 'stop', id }]),
        result: undefined,
      })),
  };
}

type StopMetadataCommands = Pick<
  StopCommands,
  'setStopName' | 'suggestStopName' | 'setStopDwellSeconds' | 'setStopMajorStop'
>;

function createStopMetadataCommands(runtime: EditorRuntime): StopMetadataCommands {
  return {
    setStopName: (id, name, options) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: setStopName(system, id, name, options?.auto ?? false),
        result: undefined,
      })),
    suggestStopName(id) {
      runtime.commitContent(undefined, ({ system }) => {
        const stop = system.stops.find((candidate) => candidate.id === id);
        if (!stop) return { system, result: undefined };
        const suggestion = suggestStopName({
          system,
          coord: stop.coord,
          anchors: stop.anchors,
        });
        const name = suggestion.name;
        const next = name ? setStopName(system, id, name, true) : system;
        return { system: next, result: undefined };
      });
    },
    setStopDwellSeconds: (id, seconds) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: setStopDwellSeconds(system, id, seconds),
        result: undefined,
      })),
    setStopMajorStop: (id, major) =>
      runtime.commitContent(undefined, ({ system }) => ({
        system: setStopMajorStop(system, id, major),
        result: undefined,
      })),
  };
}

/** Creates the stop command surface once for one editor runtime. */
export function createStopCommands(runtime: EditorRuntime): StopCommands {
  return {
    ...createStopLifecycleCommands(runtime),
    ...createStopMetadataCommands(runtime),
  };
}
