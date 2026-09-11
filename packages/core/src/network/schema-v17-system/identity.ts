import { semanticDigest } from '../../encoding/semantic-digest';
import type { Attribution, LicenseRef } from '../../source/value-types';
import type { ResolvedSourceStatus } from '../resolved-content-reference';
import type { TransitSystem } from '../../transit/authored-system';
import type { ContentRef } from '../content-reference';
import type {
  ResolvedContentDescriptor,
  ResolvedContentRef,
  ResolvedSystemRevision,
} from '../resolved-content-reference';

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

/**
 * Names the immutable revision this provider answers for.
 *
 * Absent means the provider holds a working document that nobody has
 * published. The distinction is the whole point of the type: a working
 * document is identified by what it contains and changes under the author's
 * hands, while a published revision is identified by a stored ID and cannot
 * change at all. Serving one under the other's name would let a pinned link
 * return content that has since moved.
 */
export interface SystemPublication {
  readonly systemRevisionId: string;
}

/** How storage identifies the System this provider serves. */
export interface SystemContentIdentity {
  /**
   * The ID a caller names this System by.
   *
   * Storage may identify a System differently from the document inside it — a
   * share row and the authored document it holds carry separate IDs, and a
   * ContentRef names the row. Defaulting this to the document's own ID would
   * make every reference from a host miss.
   */
  readonly contentId: string;
  readonly publication?: SystemPublication;
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
  identity: SystemContentIdentity,
): Promise<ResolvedContentDescriptor> {
  // A published revision already has a stored identity, so digesting the
  // document again would cost a full canonical encoding to learn nothing.
  const revision: ResolvedSystemRevision = identity.publication
    ? { kind: 'published', systemRevisionId: identity.publication.systemRevisionId }
    : {
        kind: 'working',
        contentDigest: await semanticDigest({
          encodingVersion: 'transit-system-json-v1',
          schemaVersion: 17,
          system,
        }),
      };
  const modes = modesInLineOrder(system);
  return {
    content: {
      kind: 'transit-system',
      id: identity.contentId,
      revision,
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

export function validateDescriptionReference(
  identity: SystemContentIdentity,
  reference: ContentRef,
): void {
  if (reference.kind !== 'transit-system' || reference.id !== identity.contentId) {
    throw new SchemaV17SystemProviderError(
      'content-not-found',
      'The requested content does not match this schema-v17 system.',
    );
  }
  // `latest` is resolved to a concrete revision before a provider is built, so
  // by the time it arrives here the caller has already chosen what it means.
  if (reference.revision.kind !== 'pinned') return;
  const publication = identity.publication;
  if (!publication) {
    throw new SchemaV17SystemProviderError(
      'revision-not-found',
      'This provider holds a working document, so it cannot answer for a pinned revision.',
    );
  }
  if (reference.revision.systemRevisionId !== publication.systemRevisionId) {
    throw new SchemaV17SystemProviderError(
      'revision-not-found',
      'This provider serves a different System revision than the pinned reference names.',
    );
  }
}

export function validateResolvedReference(
  descriptor: ResolvedContentDescriptor,
  content: ResolvedContentRef,
): void {
  if (
    content.kind !== 'transit-system' ||
    descriptor.content.kind !== 'transit-system' ||
    content.id !== descriptor.content.id
  ) {
    throw new SchemaV17SystemProviderError(
      'content-not-found',
      'The resolved content does not match this schema-v17 system.',
    );
  }
  const served = descriptor.content.revision;
  const requested = content.revision;
  // Crossing the two identities is a conflict rather than a missing revision:
  // this provider does hold the System, and it is answering under one name.
  if (served.kind !== requested.kind) {
    throw new SchemaV17SystemProviderError(
      'revision-conflict',
      `This provider serves the ${served.kind} revision, and the request names a ${requested.kind} one.`,
    );
  }
  if (
    served.kind === 'working' &&
    requested.kind === 'working' &&
    served.contentDigest.value !== requested.contentDigest.value
  ) {
    throw new SchemaV17SystemProviderError(
      'revision-conflict',
      'The working system revision no longer matches this provider.',
    );
  }
  if (
    served.kind === 'published' &&
    requested.kind === 'published' &&
    served.systemRevisionId !== requested.systemRevisionId
  ) {
    throw new SchemaV17SystemProviderError(
      'revision-conflict',
      'The published system revision no longer matches this provider.',
    );
  }
}
