import { semanticDigest } from '../../encoding/semantic-digest';
import type { Attribution, LicenseRef } from '../../source/value-types';
import type { ResolvedSourceStatus } from '../resolved-content-reference';
import type { TransitSystem } from '../../transit/authored-system';
import type { ContentRef } from '../content-reference';
import type { ResolvedContentDescriptor, ResolvedContentRef } from '../resolved-content-reference';

export type SchemaV17SystemProviderErrorCode =
  | 'content-not-found'
  | 'revision-not-found'
  | 'revision-conflict'
  | 'invalid-cursor'
  | 'invalid-authored-system';

export class SchemaV17SystemProviderError extends Error {
  readonly code: SchemaV17SystemProviderErrorCode;

  constructor(code: SchemaV17SystemProviderErrorCode, message: string) {
    super(message);
    this.name = 'SchemaV17SystemProviderError';
    this.code = code;
  }
}

interface IdentifiedRecord {
  readonly id: string;
}

/** The parser rejects a malformed document, but a provider can be handed a
 * value assembled in memory, where a duplicate ID makes one entity
 * unreachable rather than failing. */
function validateUniqueIds(system: TransitSystem): void {
  const collections: readonly (readonly [string, readonly IdentifiedRecord[]])[] = [
    ['Line', system.lines],
    ['ServicePlan', system.servicePlans],
    ['Pattern', system.patterns],
    ['Schedule', system.schedules],
    ['Alignment', system.alignments],
    ['Way', system.ways],
    ['Stop', system.stops],
    ['Station', system.stations],
    ['Node', system.nodes],
  ];
  for (const [label, values] of collections) {
    const ids = new Set<string>();
    for (const value of values) {
      if (ids.has(value.id)) {
        throw new SchemaV17SystemProviderError(
          'invalid-authored-system',
          `Invalid schema-v17 ${label} reference: duplicate ID ${value.id}.`,
        );
      }
      ids.add(value.id);
    }
  }
}

/** Every ServicePlan a Line names must exist: the descriptor reports modes in
 * Line order, and a dangling plan would drop one silently. */
function validateLinePlanMembership(system: TransitSystem): void {
  const plans = new Set(system.servicePlans.map(({ id }) => id));
  for (const line of system.lines) {
    for (const servicePlanId of line.servicePlanIds) {
      if (!plans.has(servicePlanId)) {
        throw new SchemaV17SystemProviderError(
          'invalid-authored-system',
          `Invalid schema-v17 Line reference: ${line.id} names missing ServicePlan ${servicePlanId}.`,
        );
      }
    }
  }
}

export function validateSystem(system: TransitSystem): void {
  validateUniqueIds(system);
  validateLinePlanMembership(system);
}

/** Line order, then plan order within a Line. Catalog order would be arbitrary
 * to a reader, and this list is what a host offers as mode filters. */
function modesInLineOrder(system: TransitSystem): string[] {
  const planById = new Map(system.servicePlans.map((plan) => [plan.id, plan]));
  const modes: string[] = [];
  const seen = new Set<string>();
  for (const line of system.lines) {
    for (const servicePlanId of line.servicePlanIds) {
      const modeId = planById.get(servicePlanId)?.modeId;
      if (modeId === undefined || seen.has(modeId)) continue;
      seen.add(modeId);
      modes.push(modeId);
    }
  }
  return modes;
}

/**
 * The Sources a document cites, reported in citation order.
 *
 * A citation is a stub the document carries so a binding can still be
 * explained when the Source repository is unreachable, which is exactly when
 * this matters. Freshness is unknown rather than fresh: a citation records who
 * a Source is, never when it was last read, and claiming otherwise would put
 * an age on screen that nothing measured.
 */
function sourceStatuses(system: TransitSystem): readonly ResolvedSourceStatus[] {
  return system.sourceCitations.map((citation) => ({
    sourceId: citation.sourceId,
    name: citation.name,
    attribution: citation.attribution,
    freshness: 'unknown' as const,
  }));
}

/** Deduplicated because two Sources under one publisher repeat one line, and a
 * map credits it once. */
function citedAttributions(system: TransitSystem): readonly Attribution[] {
  const byKey = new Map<string, Attribution>();
  for (const citation of system.sourceCitations) {
    const attribution = citation.attribution;
    byKey.set(`${attribution.text}\u0000${attribution.url ?? ''}`, attribution);
  }
  return [...byKey.values()];
}

function citedLicenses(system: TransitSystem): readonly LicenseRef[] {
  const byId = new Map<string, LicenseRef>();
  for (const citation of system.sourceCitations) {
    if (citation.license) byId.set(citation.license.id, citation.license);
  }
  return [...byId.values()];
}

export async function descriptorForSystem(
  system: TransitSystem,
): Promise<ResolvedContentDescriptor> {
  const contentDigest = await semanticDigest({
    encodingVersion: 'transit-system-json-v1',
    schemaVersion: 17,
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
    attributions: citedAttributions(system),
    licenses: citedLicenses(system),
    sources: sourceStatuses(system),
  };
}

export function validateDescriptionReference(system: TransitSystem, reference: ContentRef): void {
  if (reference.kind !== 'transit-system' || reference.id !== system.id) {
    throw new SchemaV17SystemProviderError(
      'content-not-found',
      'The requested content does not match this schema-v17 system.',
    );
  }
  // A pinned revision names immutable storage this provider does not have: it
  // holds one in-memory document, so answering would return working content
  // under a pinned name.
  if (reference.revision.kind === 'pinned') {
    throw new SchemaV17SystemProviderError(
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
    throw new SchemaV17SystemProviderError(
      'content-not-found',
      'The resolved content does not match this schema-v17 system.',
    );
  }
  if (content.revision.kind !== 'working') {
    throw new SchemaV17SystemProviderError(
      'revision-not-found',
      'Published system revisions are unavailable until immutable revision storage exists.',
    );
  }
  if (
    descriptor.content.kind !== 'transit-system' ||
    descriptor.content.revision.kind !== 'working' ||
    content.revision.contentDigest.value !== descriptor.content.revision.contentDigest.value
  ) {
    throw new SchemaV17SystemProviderError(
      'revision-conflict',
      'The working system revision no longer matches this provider.',
    );
  }
}
