import type { DiagramLayoutResult } from '@transitmapper/core/model/diagramLayout';
import type { TransitSystem } from '@transitmapper/core/model/system';

/** Messages carry complete immutable snapshots. The layout worker never reads
 * editor state, which makes a late answer safe to discard by request ID. */
export interface DiagramLayoutWorkerRequest {
  readonly kind: 'layout';
  readonly requestId: number;
  /** The immutable document revision, not the mutable system ID. */
  readonly revision: string;
  readonly system: TransitSystem;
}

export type DiagramLayoutWorkerEvent =
  | {
      readonly kind: 'done';
      readonly requestId: number;
      readonly revision: string;
      /** The complete result keeps layout identity and anchors available to
       * later Diagram consumers; callers that only project features use
       * `layout.system`. */
      readonly layout: DiagramLayoutResult;
    }
  | {
      readonly kind: 'error';
      readonly requestId: number;
      readonly message: string;
    };
