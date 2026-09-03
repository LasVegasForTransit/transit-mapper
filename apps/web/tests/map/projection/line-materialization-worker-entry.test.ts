import type { NetworkQueryResult } from '@transitmapper/core/network/result';
import { renderPresentationForViewport } from '@transitmapper/core/render/render-presentation';
import { describe, expect, it } from 'vitest';
import {
  installLineMaterializationWorker,
  type LineMaterializationWorkerScope,
} from '../../../src/map/projection/line-materialization-worker-entry';
import type {
  LineMaterializationWorkerEvent,
  LineMaterializationWorkerRequest,
} from '../../../src/map/projection/line-materialization-worker-protocol';

class FakeWorkerScope implements LineMaterializationWorkerScope {
  onmessage: ((event: MessageEvent<LineMaterializationWorkerRequest>) => void) | null = null;
  readonly events: LineMaterializationWorkerEvent[] = [];

  postMessage(event: LineMaterializationWorkerEvent): void {
    this.events.push(event);
  }

  dispatch(request: LineMaterializationWorkerRequest): void {
    this.onmessage?.({ data: request } as MessageEvent<LineMaterializationWorkerRequest>);
  }
}

function input() {
  return {
    result: {
      descriptor: {} as NetworkQueryResult['descriptor'],
      coverage: [],
      lineOrder: [],
      chunks: [],
    },
    presentation: renderPresentationForViewport({
      center: [0, 0],
      zoom: 12,
      width: 1_280,
      height: 720,
    }),
    carrierRule: 'shared-alignment' as const,
  };
}

describe('Line materialization Worker runtime', () => {
  it('posts one aggregate bundle result after private materialization settles', async () => {
    const scope = new FakeWorkerScope();
    installLineMaterializationWorker(scope, {
      materialize: () => Promise.resolve({ kind: 'ready', bundles: [], visibleFragments: [] }),
    });

    scope.dispatch({ kind: 'materialize', requestId: 1, sessionId: 'one', input: input() });
    await Promise.resolve();

    expect(scope.events).toEqual([
      {
        kind: 'materialized',
        requestId: 1,
        sessionId: 'one',
        result: { kind: 'ready', bundles: [], visibleFragments: [] },
      },
    ]);
  });

  it('does not publish an aggregate from a released session after replacement', async () => {
    const scope = new FakeWorkerScope();
    let resolveOld:
      | ((result: { kind: 'ready'; bundles: never[]; visibleFragments: never[] }) => void)
      | undefined;
    let calls = 0;
    installLineMaterializationWorker(scope, {
      materialize: () => {
        calls += 1;
        if (calls === 1) {
          return new Promise((resolve) => {
            resolveOld = resolve;
          });
        }
        return Promise.resolve({ kind: 'ready', bundles: [], visibleFragments: [] });
      },
    });

    scope.dispatch({ kind: 'materialize', requestId: 1, sessionId: 'old', input: input() });
    scope.dispatch({ kind: 'release', requestId: 1, sessionId: 'old' });
    scope.dispatch({ kind: 'materialize', requestId: 2, sessionId: 'new', input: input() });
    await Promise.resolve();

    resolveOld?.({ kind: 'ready', bundles: [], visibleFragments: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(scope.events).toEqual([
      {
        kind: 'materialized',
        requestId: 2,
        sessionId: 'new',
        result: { kind: 'ready', bundles: [], visibleFragments: [] },
      },
    ]);
  });

  it('does not publish an error from a released session that later fails', async () => {
    const scope = new FakeWorkerScope();
    let rejectOld: ((error: Error) => void) | undefined;
    installLineMaterializationWorker(scope, {
      materialize: () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    });

    scope.dispatch({ kind: 'materialize', requestId: 1, sessionId: 'old', input: input() });
    scope.dispatch({ kind: 'release', requestId: 1, sessionId: 'old' });
    rejectOld?.(new Error('The released materialization failed.'));
    await Promise.resolve();
    await Promise.resolve();

    expect(scope.events).toEqual([]);
  });
});
