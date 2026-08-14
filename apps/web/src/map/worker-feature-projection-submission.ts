/**
 * Bridges one detached worker result into an accepted-scene publication.
 *
 * The worker may finish after a newer edit has replaced it. This boundary
 * owns the abort signal and refuses to call `commit` after cancellation, so
 * the worker can never turn a stale document snapshot into visible geometry.
 */
import type {
  FeatureProjectionClientInput,
  FeatureProjectionResult,
} from './feature-projection-worker';

export interface WorkerFeatureProjectionClient {
  project(
    input: FeatureProjectionClientInput,
    signal?: AbortSignal,
  ): Promise<FeatureProjectionResult>;
}

export interface WorkerFeatureProjectionCommitContinuation {
  readonly settled: Promise<void>;
  cancel(): boolean;
}

export interface WorkerFeatureProjectionContinuation extends WorkerFeatureProjectionCommitContinuation {
  /** Worker replies are not scheduler frames. Source publication receives its
   * own physical generation after this detached result is ready. */
  readonly generation: null;
  readonly settled: Promise<void>;
  cancel(): boolean;
}

export interface SubmitWorkerFeatureProjectionOptions {
  readonly worker: WorkerFeatureProjectionClient;
  /** A Diagram request resolves its worker-owned schematic snapshot here;
   * geographic requests return immediately. Either way, no source mutation
   * begins before this immutable projection input exists. */
  input(signal: AbortSignal): FeatureProjectionClientInput | Promise<FeatureProjectionClientInput>;
  /** Lets the document generation retain worker-local operation counts only
   * after the same result is about to cross into source publication. */
  onProjected?(result: FeatureProjectionResult): void;
  commit(
    features: FeatureProjectionResult['features'],
  ): WorkerFeatureProjectionCommitContinuation | null;
}

export type WorkerFeatureProjectionSubmission = WorkerFeatureProjectionContinuation;

export function submitWorkerFeatureProjection(
  options: SubmitWorkerFeatureProjectionOptions,
): WorkerFeatureProjectionSubmission {
  const abort = new AbortController();
  let continuation: WorkerFeatureProjectionCommitContinuation | null = null;
  let canceled = false;
  const settled = Promise.resolve(options.input(abort.signal))
    .then((input) => options.worker.project(input, abort.signal))
    .then((result) => {
      if (canceled || abort.signal.aborted) {
        throw (
          abort.signal.reason ??
          new DOMException('Feature projection was superseded.', 'AbortError')
        );
      }
      options.onProjected?.(result);
      continuation = options.commit(result.features);
      return continuation?.settled;
    });
  return {
    generation: null,
    settled,
    cancel: () => {
      if (canceled) return false;
      canceled = true;
      abort.abort(new DOMException('Feature projection was superseded.', 'AbortError'));
      return continuation?.cancel() ?? true;
    },
  };
}
