import { semanticDigest } from '../../encoding/semantic-digest';
import { servicesForLine, validateLineServiceMembership } from '../../model/line-service';
import type { TransitSystem } from '../../model/system';
import type { ContentDigest } from '../../source/value-types';
import type { ResolveOptions } from '../content-provider';
import type { ContentRef } from '../content-reference';
import type { NetworkQuery, ViewFilterValue } from '../query';
import type { ResolvedContentDescriptor, ResolvedContentRef } from '../resolved-content-reference';
import { legacyDerivedId } from '../../model/schema-v16-system/legacy-id';

const textEncoder = new TextEncoder();

export { legacyDerivedId, semanticDigest };

export type SchemaV16SystemProviderErrorCode =
  | 'content-not-found'
  | 'revision-not-found'
  | 'revision-conflict'
  | 'invalid-cursor'
  | 'invalid-legacy-system';

export class SchemaV16SystemProviderError extends Error {
  readonly code: SchemaV16SystemProviderErrorCode;

  constructor(code: SchemaV16SystemProviderErrorCode, message: string) {
    super(message);
    this.name = 'SchemaV16SystemProviderError';
    this.code = code;
  }
}

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

function validateUniqueIds(system: TransitSystem): void {
  const collections = [
    ['Line', system.lines],
    ['Service', system.services],
    ['Way', system.ways],
    ['Stop', system.stops],
    ['Station', system.stations],
    ['Facility', system.facilities],
    ['Group', system.groups],
    ['Node', system.nodes],
    ['NamedWay', system.namedWays],
  ] as const;
  for (const [label, values] of collections) {
    const ids = new Set<string>();
    for (const value of values) {
      if (ids.has(value.id)) {
        throw new SchemaV16SystemProviderError(
          'invalid-legacy-system',
          `Invalid schema-v16 ${label} reference: duplicate ID ${value.id}.`,
        );
      }
      ids.add(value.id);
    }
  }
}

export function validateSystem(system: TransitSystem): void {
  validateUniqueIds(system);
  const issues = validateLineServiceMembership(system).filter(
    (issue) => issue.kind !== 'empty-line',
  );
  if (issues.length === 0) return;
  throw new SchemaV16SystemProviderError(
    'invalid-legacy-system',
    `Invalid schema-v16 Line-to-Service reference: ${issues.map((issue) => issue.kind).join(', ')}.`,
  );
}

function modesInLineOrder(system: TransitSystem): string[] {
  const modes: string[] = [];
  const seen = new Set<string>();
  for (const line of system.lines) {
    for (const service of servicesForLine(system, line.id)) {
      if (seen.has(service.modeId)) continue;
      seen.add(service.modeId);
      modes.push(service.modeId);
    }
  }
  return modes;
}

export async function descriptorForSystem(
  system: TransitSystem,
): Promise<ResolvedContentDescriptor> {
  const contentDigest = await semanticDigest({
    encodingVersion: 'transit-system-json-v1',
    schemaVersion: 16,
    system,
  });
  const modes = modesInLineOrder(system);
  return {
    content: {
      kind: 'transit-system',
      id: system.id,
      revision: { kind: 'working', contentDigest },
    },
    map: {
      defaultRepresentationId: 'network',
      representationIds: ['network', 'infrastructure', 'diagram'],
      modeIds: modes,
      defaultModeIds: modes,
      filters: [],
    },
    attributions: [],
    licenses: [],
    sources: [],
  };
}

export function validateDescriptionReference(system: TransitSystem, reference: ContentRef): void {
  if (reference.kind !== 'transit-system' || reference.id !== system.id) {
    throw new SchemaV16SystemProviderError(
      'content-not-found',
      'The requested content does not match this schema-v16 system.',
    );
  }
  if (reference.revision.kind === 'pinned') {
    throw new SchemaV16SystemProviderError(
      'revision-not-found',
      'Pinned system revisions are unavailable until immutable revision storage exists.',
    );
  }
}

export function validateResolvedReference(
  descriptor: ResolvedContentDescriptor,
  content: ResolvedContentRef,
): void {
  if (content.kind !== 'transit-system' || content.id !== descriptor.content.id) {
    throw new SchemaV16SystemProviderError(
      'content-not-found',
      'The resolved content does not match this schema-v16 system.',
    );
  }
  if (content.revision.kind !== 'working') {
    throw new SchemaV16SystemProviderError(
      'revision-not-found',
      'Published system revisions are unavailable until immutable revision storage exists.',
    );
  }
  if (
    descriptor.content.kind !== 'transit-system' ||
    descriptor.content.revision.kind !== 'working' ||
    content.revision.contentDigest.value !== descriptor.content.revision.contentDigest.value
  ) {
    throw new SchemaV16SystemProviderError(
      'revision-conflict',
      'The working system revision no longer matches this provider.',
    );
  }
}
