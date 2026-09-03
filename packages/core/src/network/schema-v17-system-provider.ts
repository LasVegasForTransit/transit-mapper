import type { TransitSystem } from '../transit/authored-system';
import type { ContentProvider } from './content-provider';
import { abortIfRequested, networkQueryDigest } from './provider-identity';
import type { NetworkQueryResult } from './result';
import { mapChunk } from './schema-v17-system/chunk';
import {
  descriptorForSystem,
  SchemaV17SystemProviderError,
  validateDescriptionReference,
  validateResolvedReference,
  validateSystem,
  type SchemaV17SystemProviderErrorCode,
} from './schema-v17-system/identity';
import { derivedId } from '../model/derived-id';

export { SchemaV17SystemProviderError, type SchemaV17SystemProviderErrorCode };

export function createSchemaV17SystemProvider(input: TransitSystem): ContentProvider {
  // The provider answers from a document nobody else can edit underneath it: a
  // caller holding the original could mutate an array between describe and
  // resolve, and the digest would then describe content the chunk does not.
  const system = structuredClone(input);
  let descriptorPromise: ReturnType<typeof descriptorForSystem> | undefined;
  const descriptor = () => {
    validateSystem(system);
    descriptorPromise ??= descriptorForSystem(system);
    return descriptorPromise;
  };
  return {
    async describe(reference, options) {
      abortIfRequested(options);
      validateDescriptionReference(system, reference);
      const result = await descriptor();
      abortIfRequested(options);
      return result;
    },
    async resolve(content, query, options): Promise<NetworkQueryResult> {
      abortIfRequested(options);
      if (query.cursor !== undefined) {
        throw new SchemaV17SystemProviderError(
          'invalid-cursor',
          'The schema-v17 system provider emits one page and does not accept cursors.',
        );
      }
      const resolvedDescriptor = await descriptor();
      abortIfRequested(options);
      validateResolvedReference(resolvedDescriptor, content);
      const queryDigest = await networkQueryDigest(resolvedDescriptor.content, query);
      abortIfRequested(options);
      const chunk = mapChunk({
        system,
        bounds: query.bounds,
        modes: query.modes,
        detailBand: query.detailBand,
        chunkId: derivedId('v17', 'network-chunk', system.id, queryDigest.value),
      });
      abortIfRequested(options);
      return {
        descriptor: resolvedDescriptor,
        coverage: [
          {
            area: { kind: 'unknown' },
            sourceIds: [],
            coverage: 'unknown',
            availability: 'available',
            freshness: 'not-applicable',
            // A v17 document states no calendar-level service of its own here,
            // and this provider was given no service instant to judge one by.
            serviceEvidence: 'unknown',
            filterEffect: query.modes.kind === 'all' ? 'not-applied' : 'partial',
          },
        ],
        lineOrder: system.lines.map((line, rank) => ({ lineId: line.id, rank })),
        chunks: [chunk],
      };
    },
  };
}
