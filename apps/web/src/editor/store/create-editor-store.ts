import { shortId } from '@transitmapper/core/model/ids';
import { DEFAULT_VIEWPORT } from '@transitmapper/core/model/system';
import { createDocumentCommands, createHistoryCommands } from './commands/document-commands';
import { createFacilityCommands } from './commands/facility-commands';
import { createGroupCommands } from './commands/group-commands';
import { createImportCommands } from './commands/import-commands';
import { createNetworkCommands } from './commands/network-commands';
import { createRoutingCommands } from './commands/routing-commands';
import { createSelectionCommands } from './commands/selection-commands';
import { createServiceCompositionCommands } from './commands/service-composition-commands';
import { createServiceGestureCommands } from './commands/service-gesture-commands';
import { createServiceMetadataCommands } from './commands/service-metadata-commands';
import { createServicePatternCommands } from './commands/service-pattern-commands';
import { createStopCommands } from './commands/stop-commands';
import { createStationCommands } from './commands/station-commands';
import { createToolCommands } from './commands/tool-commands';
import { createWayCommands } from './commands/way-commands';
import type { CreateEditorStoreOptions, EditorCommands, EditorStore } from './contracts';
import type { ServiceCommands } from './contracts/service-commands';
import { createEditorRuntime } from './runtime';

/** Composes one isolated editor runtime and its stable command groups. */
export function createEditorStore(options: CreateEditorStoreOptions = {}): EditorStore {
  const runtime = createEditorRuntime(options);
  const networkCommands = createNetworkCommands(runtime);
  const importCommands = createImportCommands(runtime);
  const routingCommands = createRoutingCommands(runtime);
  const wayOptions = { createId: shortId };
  const wayCommands = createWayCommands(runtime, wayOptions);
  const serviceCommands: ServiceCommands = {
    ...createServiceMetadataCommands(runtime),
    ...createServicePatternCommands(runtime),
    ...createServiceGestureCommands(runtime),
    ...createServiceCompositionCommands(runtime),
  };

  const commands: EditorCommands = {
    document: createDocumentCommands(runtime),
    history: createHistoryCommands(runtime),
    tools: createToolCommands(runtime, wayOptions),
    selection: createSelectionCommands(runtime),
    ways: wayCommands,
    network: networkCommands,
    imports: importCommands,
    routing: routingCommands,
    services: serviceCommands,
    stops: createStopCommands(runtime),
    stations: createStationCommands(runtime),
    facilities: createFacilityCommands(runtime),
    groups: createGroupCommands(runtime, {
      readCameraCenter:
        options.readCameraCenter ??
        (() => [DEFAULT_VIEWPORT.center[0], DEFAULT_VIEWPORT.center[1]]),
    }),
  };

  return {
    commands,
    getState: runtime.read,
    getInitialState: runtime.getInitialState,
    subscribe: runtime.subscribe,
  };
}
