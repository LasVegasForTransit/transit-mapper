// The live renderer bound to a MapLibre map: source banks, the layer
// controller that flips between them, and the settlement host that decides
// when a bank has actually painted. The scene types come straight from the
// renderer so a caller replacing `@transitmapper/renderer/runtime` with this
// entry point keeps every name it had.
export type {
  AcceptedSceneUpdate,
  RenderSceneSourceUpdateResult,
  SceneFeatureTarget,
} from '@transitmapper/renderer/runtime';
export {
  createLiveMapRenderer,
  type LiveMapRenderer,
  type LiveMapRendererHost,
  type SceneTargetResolver,
} from './live-map-renderer';
export { createSourceBankController, type SourceBankDiagnostics } from './sources/source-bank';
export { createSourceBankLayerController } from './sources/source-bank-layers';
export type { SourceBankSettlementHost } from './sources/source-bank-settlement';
