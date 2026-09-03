import { semanticDigest } from '../../encoding/semantic-digest';
import type { ExternalRef } from '../../source/source-reference';
import type { SourceBinding, TransitSystem } from '../../transit/authored-system';
import type { TransitEntityRef } from '../../transit/entity-ref';
import { transitEntityKey } from '../transit-entity-ref';

interface IdentifiedRecord {
  readonly id: string;
}

/** Every entity kind the authored document actually carries, and where. Kinds
 * absent here — publisher, agency, operator, operational-change, advisory,
 * lane-connector — are named by `TransitEntityRef` but stored outside the
 * System, so a binding cannot claim to have rewritten one. */
function targetIdsByKind(system: TransitSystem): ReadonlyMap<string, ReadonlySet<string>> {
  const arrays: readonly (readonly [string, readonly IdentifiedRecord[]])[] = [
    ['alignment', system.alignments],
    ['way', system.ways],
    ['line', system.lines],
    ['service-plan', system.servicePlans],
    ['pattern', system.patterns],
    ['schedule', system.schedules],
    ['calendar', system.calendars],
    ['trip', system.trips],
    ['frequency-rule', system.frequencyRules],
    ['stop', system.stops],
    ['station', system.stations],
    ['facility', system.facilities],
    ['group', system.groups],
    ['node', system.nodes],
    ['named-way', system.namedWays],
  ];
  const components: readonly (readonly [string, Readonly<Record<string, unknown>>])[] = [
    ['median', system.medians],
    ['turn-restriction', system.turnRestrictions],
    ['approach-control', system.approachControls],
  ];
  const byKind = new Map<string, ReadonlySet<string>>();
  for (const [kind, records] of arrays) byKind.set(kind, new Set(records.map(({ id }) => id)));
  for (const [kind, record] of components) byKind.set(kind, new Set(Object.keys(record)));
  return byKind;
}

/** Component-encoded so that a source ID containing a separator cannot collide
 * with a different identity that merely spells the same concatenation. */
function externalKey(external: ExternalRef): string {
  return [external.sourceId, external.kind, external.id].map(encodeURIComponent).join(':');
}

function requireExistingTarget(
  binding: SourceBinding,
  byKind: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const ids = byKind.get(binding.target.kind);
  if (!ids) {
    throw new Error(
      `Source binding target kind ${binding.target.kind} is not carried by an authored System.`,
    );
  }
  if (!ids.has(binding.target.id)) {
    throw new Error(
      `Source binding target ${binding.target.kind} ${binding.target.id} does not exist.`,
    );
  }
}

/** One active binding per external identity and per authored target. A new
 * Source revision advances `lastAppliedRevisionId` on the binding that already
 * exists; it never adds a second one, so a duplicate here means two Sources
 * each believe they own the same entity. */
function requireUniqueActiveBindings(bindings: readonly SourceBinding[]): void {
  const seenExternal = new Set<string>();
  const seenTarget = new Set<string>();
  for (const binding of bindings) {
    const external = externalKey(binding.external);
    if (seenExternal.has(external)) {
      throw new Error(`Duplicate active Source binding for external reference ${external}.`);
    }
    seenExternal.add(external);
    const target = transitEntityKey(binding.target);
    if (seenTarget.has(target)) {
      throw new Error(`Duplicate active Source binding for target ${target}.`);
    }
    seenTarget.add(target);
  }
}

/** A portable export must explain every binding it carries even when the Source
 * repository is unreachable, so the citation stub travels with the document. */
function requireCitationForEveryBoundSource(system: TransitSystem): void {
  const cited = new Set(system.sourceCitations.map(({ sourceId }) => sourceId));
  for (const binding of system.sourceBindings) {
    if (!cited.has(binding.external.sourceId)) {
      throw new Error(`Source binding cites no Source citation for ${binding.external.sourceId}.`);
    }
  }
}

/** A one-time upload is an event, not an update channel: it carries an artifact
 * digest rather than a Dataset revision, so nothing can reimport through it. A
 * binding naming one as its last applied revision would claim managed update
 * authority the upload never granted. */
function requireManagedBindingRevisions(system: TransitSystem): void {
  const oneTimeUploadIds = new Set(
    system.importHistory
      .filter((entry) => entry.origin.kind === 'one-time-upload')
      .map((entry) => entry.id),
  );
  for (const binding of system.sourceBindings) {
    if (oneTimeUploadIds.has(binding.lastAppliedRevisionId)) {
      throw new Error(
        `Source binding for ${binding.external.sourceId} claims a managed binding on one-time upload ${binding.lastAppliedRevisionId}.`,
      );
    }
  }
}

export function validateAuthoredProvenanceRelationships(system: TransitSystem): void {
  const byKind = targetIdsByKind(system);
  for (const binding of system.sourceBindings) requireExistingTarget(binding, byKind);
  requireUniqueActiveBindings(system.sourceBindings);
  requireCitationForEveryBoundSource(system);
  requireManagedBindingRevisions(system);
}

export interface SourceBindingBaselineInputs {
  readonly external: ExternalRef;
  readonly target: TransitEntityRef;
  /** The one normalized source record, before authored conversion. */
  readonly record: unknown;
  /** The one canonical authored entity, after conversion. */
  readonly entity: unknown;
}

export interface RecomputedSourceBindingBaseline {
  /** Lowercase hexadecimal, matching what a parsed baseline stores. */
  readonly sourceHash: string;
  readonly targetHash: string;
}

/**
 * Recomputes both baseline hashes from the inputs a caller supplies.
 *
 * Neither value lives in the authored document: `record` is the source-side
 * payload and `entity` is one converted entity, so this cannot run inside the
 * synchronous parse path and is invoked by the importer that holds both. The
 * shapes are fixed by the transit data types spec and must not drift, because
 * a reimport compares a stored baseline against exactly these bytes.
 */
export async function recomputeSourceBindingBaseline({
  external,
  target,
  record,
  entity,
}: SourceBindingBaselineInputs): Promise<RecomputedSourceBindingBaseline> {
  const [source, target_] = await Promise.all([
    semanticDigest({
      version: 'source-binding-baseline-v1',
      schemaVersion: '17',
      normalizerVersion: 'reviewed-import-v1',
      external,
      record,
    }),
    semanticDigest({
      version: 'target-binding-baseline-v1',
      schemaVersion: '17',
      normalizerVersion: 'reviewed-import-v1',
      target,
      entity,
    }),
  ]);
  return { sourceHash: source.value, targetHash: target_.value };
}

/** Rejects a baseline whose recorded identity does not match the record or
 * entity supplied for recomputation. */
export async function assertSourceBindingBaseline(
  binding: SourceBinding,
  inputs: Pick<SourceBindingBaselineInputs, 'record' | 'entity'>,
): Promise<void> {
  const recomputed = await recomputeSourceBindingBaseline({
    external: binding.external,
    target: binding.target,
    record: inputs.record,
    entity: inputs.entity,
  });
  if (recomputed.sourceHash !== binding.baseline.sourceHash) {
    throw new Error(
      `Source binding baseline source hash does not match the supplied record for ${binding.external.sourceId}.`,
    );
  }
  if (recomputed.targetHash !== binding.baseline.targetHash) {
    throw new Error(
      `Source binding baseline target hash does not match the supplied entity for ${transitEntityKey(binding.target)}.`,
    );
  }
}
