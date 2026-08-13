import type { DocumentCommands, HistoryCommands } from './contracts/document-commands';
import type { ImportCommands, RoutingCommands } from './contracts/import-routing-commands';
import type {
  FacilityCommands,
  GroupCommands,
  StationCommands,
  StopCommands,
} from './contracts/place-commands';
import type { ServiceCommands } from './contracts/service-commands';
import type { SelectionCommands, ToolCommands } from './contracts/tool-selection-commands';
import type { NetworkCommands, WayCommands } from './contracts/way-network-commands';
import type { EditorState } from './state';

export interface EditorCommands {
  readonly document: DocumentCommands;
  readonly history: HistoryCommands;
  readonly tools: ToolCommands;
  readonly selection: SelectionCommands;
  readonly ways: WayCommands;
  readonly network: NetworkCommands;
  readonly imports: ImportCommands;
  readonly routing: RoutingCommands;
  readonly services: ServiceCommands;
  readonly stops: StopCommands;
  readonly stations: StationCommands;
  readonly facilities: FacilityCommands;
  readonly groups: GroupCommands;
}

export interface EditorStore {
  readonly commands: EditorCommands;
  readonly getState: () => EditorState;
  readonly getInitialState: () => EditorState;
  readonly subscribe: (listener: (state: EditorState, previous: EditorState) => void) => () => void;
}

export interface CreateEditorStoreOptions {
  documentStatus?: EditorState['documentStatus'];
}

export type { EditorState } from './state';
export type { MultiSelectItem, Selection, SelectVariant, Tool } from './state';
