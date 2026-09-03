import type { NetworkQueryResult } from '@transitmapper/core/network/result';
import type { MapPresentation } from '@transitmapper/core/presentation/map-presentation';
import type {
  MaterializeLineBundlesResult,
  materializeLineBundles,
} from '@transitmapper/renderer/line';

type LineMaterializationCarrierRule = Parameters<typeof materializeLineBundles>[0]['carrierRule'];

export interface LineMaterializationWorkerInput {
  readonly result: NetworkQueryResult;
  readonly presentation: MapPresentation;
  readonly carrierRule: LineMaterializationCarrierRule;
}

/** The browser receives only settled bundle records, never per-Line projection state. */
export type LineMaterializationWorkerResult = MaterializeLineBundlesResult;

export type LineMaterializationWorkerRequest =
  | {
      readonly kind: 'materialize';
      readonly requestId: number;
      readonly sessionId: string;
      readonly input: LineMaterializationWorkerInput;
    }
  | { readonly kind: 'release'; readonly requestId: number; readonly sessionId: string };

export type LineMaterializationWorkerEvent =
  | {
      readonly kind: 'materialized';
      readonly requestId: number;
      readonly sessionId: string;
      readonly result: LineMaterializationWorkerResult;
    }
  | {
      readonly kind: 'error';
      readonly requestId: number;
      readonly sessionId: string;
      readonly message: string;
    };
