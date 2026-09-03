import {
  materializeExactLineSpans,
  type MaterializeExactLineSpansResult,
} from './line-span-materialization';
import type { SameLineCarrierRule } from './line-span-candidate-groups';
import type { PreparedLineSpanCandidateContext } from './line-span-candidates';

export interface LineMaterializationSession {
  readonly context: PreparedLineSpanCandidateContext;
  readonly carrierRule: SameLineCarrierRule;
  readonly nextLineIndex: number;
}

export interface CreateLineMaterializationSessionOptions {
  readonly context: PreparedLineSpanCandidateContext;
  readonly carrierRule: SameLineCarrierRule;
}

export type AdvanceLineMaterializationSessionResult =
  | {
      readonly kind: 'advanced';
      readonly lineId: string;
      readonly materialization: MaterializeExactLineSpansResult;
      readonly next: LineMaterializationSession;
    }
  | { readonly kind: 'complete' };

export function createLineMaterializationSession(
  options: CreateLineMaterializationSessionOptions,
): LineMaterializationSession {
  return { ...options, nextLineIndex: 0 };
}

/** Materializes exactly one dataset-ranked Line partition for each advancement. */
export async function advanceLineMaterializationSession(
  session: LineMaterializationSession,
): Promise<AdvanceLineMaterializationSessionResult> {
  if (session.nextLineIndex >= session.context.lineIds.length) return { kind: 'complete' };
  const lineId = session.context.lineIds[session.nextLineIndex];
  const materialization = await materializeExactLineSpans({
    context: session.context,
    lineId,
    carrierRule: session.carrierRule,
  });
  return {
    kind: 'advanced',
    lineId,
    materialization,
    next: { ...session, nextLineIndex: session.nextLineIndex + 1 },
  };
}
