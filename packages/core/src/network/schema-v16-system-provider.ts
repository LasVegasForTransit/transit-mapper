import type { TransitSystem } from '../model/system';
import type { ContentProvider } from './content-provider';
import type { NetworkQueryResult } from './result';
import { mapChunk } from './schema-v16-system/chunk';
import {
  abortIfRequested,
  descriptorForSystem,
  legacyDerivedId,
  networkQueryDigest,
  SchemaV16SystemProviderError,
  validateDescriptionReference,
  validateResolvedReference,
  validateSystem,
  type SchemaV16SystemProviderErrorCode,
} from './schema-v16-system/identity';
import {
  queryFilterEffect,
  queryServiceEvidence,
  selectedServices,
} from './schema-v16-system/selection';

export { legacyDerivedId, SchemaV16SystemProviderError, type SchemaV16SystemProviderErrorCode };

export interface SchemaV16SystemProviderOptions {
  yieldControl?: () => Promise<void>;
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createSchemaV16SystemProvider(
  input: TransitSystem,
  providerOptions: SchemaV16SystemProviderOptions = {},
): ContentProvider {
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
        throw new SchemaV16SystemProviderError(
          'invalid-cursor',
          'The schema-v16 system provider emits one page and does not accept cursors.',
        );
      }
      const resolvedDescriptor = await descriptor();
      abortIfRequested(options);
      validateResolvedReference(resolvedDescriptor, content);
      const queryDigest = await networkQueryDigest(resolvedDescriptor.content, query);
      abortIfRequested(options);
      const checkpoint = async () => {
        await (providerOptions.yieldControl ?? yieldToHost)();
        abortIfRequested(options);
      };
      const chunk = await mapChunk(
        system,
        query,
        legacyDerivedId('network-chunk', system.id, queryDigest.value),
        checkpoint,
      );
      abortIfRequested(options);
      const services = selectedServices(system, query);
      const serviceEvidence = queryServiceEvidence(
        system,
        query,
        chunk.geometry.visiblePatternLegFragmentIds.length > 0,
      );
      await checkpoint();
      return {
        descriptor: resolvedDescriptor,
        coverage: [
          {
            area: { kind: 'unknown' },
            sourceIds: [],
            coverage: 'unknown',
            availability: 'available',
            freshness: 'not-applicable',
            serviceEvidence,
            filterEffect: queryFilterEffect(system, services, query),
          },
        ],
        lineOrder: system.lines.map((line, rank) => ({ lineId: line.id, rank })),
        chunks: [chunk],
      };
    },
  };
}
