import { projectResolvedNetwork } from '@transitmapper/renderer/network';
import { materializeLineBundles } from '@transitmapper/renderer/line';
import type {
  LineMaterializationWorkerEvent,
  LineMaterializationWorkerRequest,
} from './line-materialization-worker-protocol';

export interface LineMaterializationWorkerScope {
  onmessage: ((event: MessageEvent<LineMaterializationWorkerRequest>) => void) | null;
  postMessage(event: LineMaterializationWorkerEvent): void;
}

export interface LineMaterializationWorkerDependencies {
  readonly materialize?: typeof materializeLineBundles;
}

/** The Worker keeps projections and per-Line progress private until the aggregate settles. */
export function installLineMaterializationWorker(
  scope: LineMaterializationWorkerScope,
  dependencies: LineMaterializationWorkerDependencies = {},
): void {
  const materialize: typeof materializeLineBundles =
    dependencies.materialize ?? materializeLineBundles;
  let active: { readonly sessionId: string } | undefined;
  const handleMessage = async (
    event: MessageEvent<LineMaterializationWorkerRequest>,
  ): Promise<void> => {
    const request = event.data;
    let materializing: { readonly sessionId: string } | undefined;
    try {
      if (request.kind === 'release') {
        if (active?.sessionId === request.sessionId) active = undefined;
        return;
      }
      if (active !== undefined) throw new Error('Line Worker already has an active session.');
      materializing = { sessionId: request.sessionId };
      active = materializing;
      const result = await materialize({
        projection: projectResolvedNetwork(request.input.result, request.input.presentation),
        carrierRule: request.input.carrierRule,
      });
      if (active !== materializing) return;
      active = undefined;
      scope.postMessage({
        kind: 'materialized',
        requestId: request.requestId,
        sessionId: request.sessionId,
        result,
      });
    } catch (error) {
      // A released session may still reject while unwinding. It must not publish after replacement.
      if (materializing !== undefined && active !== materializing) return;
      if (active === materializing) active = undefined;
      scope.postMessage({
        kind: 'error',
        requestId: request.requestId,
        sessionId: request.sessionId,
        message: error instanceof Error ? error.message : 'Line materialization Worker failed.',
      });
    }
  };
  scope.onmessage = (event) => {
    void handleMessage(event);
  };
}

installLineMaterializationWorker(globalThis);
