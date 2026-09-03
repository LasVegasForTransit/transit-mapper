import { semanticDigest } from '../encoding/semantic-digest';
import type { ContentDigest } from '../source/value-types';
import type { ResolveOptions } from './content-provider';
import type { NetworkQuery, ViewFilterValue } from './query';
import type { ResolvedContentRef } from './resolved-content-reference';

const textEncoder = new TextEncoder();

/** Byte order rather than UTF-16 code-unit order, so the digest a provider
 * computes does not depend on which host sorted the query. */
function compareUtf8(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function sortedUtf8(values: readonly string[]): string[] {
  return [...values].sort(compareUtf8);
}

/** Drops the cursor and orders every set-valued field, so two callers asking
 * the same question in a different order share one cache entry. */
function canonicalNetworkQuery(query: NetworkQuery): NetworkQuery {
  const filters: Record<string, ViewFilterValue> = {};
  for (const [id, value] of Object.entries(query.filters)) {
    filters[id] = Array.isArray(value) ? sortedUtf8(value) : value;
  }
  const normalized: NetworkQuery = {
    ...query,
    modes:
      query.modes.kind === 'only'
        ? { kind: 'only', ids: sortedUtf8(query.modes.ids) }
        : query.modes,
    filters,
  };
  delete normalized.cursor;
  return normalized;
}

/** Schema-neutral: the query and the resolved reference identify a page of
 * content whatever document version produced it. */
export function networkQueryDigest(
  content: ResolvedContentRef,
  query: NetworkQuery,
): Promise<ContentDigest> {
  return semanticDigest({
    version: 'network-query-v1',
    content,
    query: canonicalNetworkQuery(query),
  });
}

export function abortIfRequested(options?: ResolveOptions): void {
  if (options?.signal?.aborted) throw new Error('Provider request aborted.');
}
