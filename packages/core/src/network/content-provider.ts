import type { ContentRef } from './content-reference';
import type { NetworkQuery } from './query';
import type { ResolvedContentDescriptor, ResolvedContentRef } from './resolved-content-reference';
import type { NetworkQueryResult } from './result';

export interface ResolveOptions {
  signal?: AbortSignal;
}

export interface ContentProvider {
  describe(reference: ContentRef, options?: ResolveOptions): Promise<ResolvedContentDescriptor>;
  resolve(
    content: ResolvedContentRef,
    query: NetworkQuery,
    options?: ResolveOptions,
  ): Promise<NetworkQueryResult>;
}
