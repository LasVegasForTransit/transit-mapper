/** Validates the machine-observable half of the appendix: interaction work
 * counters and the physical identities involved in an atomic bank promotion. */
import { RENDERER_LOD_ACCEPTANCE_ASSERTION_IDS } from '../../src/perf/renderer-lod-acceptance';
import { SRC_HIT_FEATURES } from '@transitmapper/map/layers';
import { LIGHT_LAYER_SPECS } from '../../src/map/layers/layerSpecs';
import { isBankedRenderLayer } from '@transitmapper/map/layers';
import { COMMITTED_SYSTEM_FEATURE_SOURCES } from '@transitmapper/map/layers';
import type { RendererLodAcceptanceBankIdentity } from './lod-acceptance-types';
import {
  computedDelta,
  exactIdSet,
  record,
  SHA_256,
  statsEqual,
  validCamera,
  validFixture,
  validStats,
} from './lod-acceptance-validation-primitives';

const ZERO_COMMITTED_ASSERTIONS = new Set([
  'hover-zero-committed-work',
  'selection-zero-committed-work',
  'filter-zero-committed-work',
  'retained-theme-zero-committed-work',
  'accepted-camera-reuses-scene',
]);
const ASSERTION_IDS = new Set<string>(RENDERER_LOD_ACCEPTANCE_ASSERTION_IDS);
const EXPECTED_VISIBLE_SOURCE_IDS = [...COMMITTED_SYSTEM_FEATURE_SOURCES].sort();
const EXPECTED_VISIBLE_SOURCE_ID_SET = new Set<string>(EXPECTED_VISIBLE_SOURCE_IDS);
const BANKED_LAYER_SPECS = LIGHT_LAYER_SPECS.filter(isBankedRenderLayer);
const EXPECTED_VISIBLE_LAYER_IDS = BANKED_LAYER_SPECS.filter(
  (spec) => !('source' in spec) || spec.source !== SRC_HIT_FEATURES,
)
  .map((spec) => spec.id)
  .sort();
const EXPECTED_HIT_LAYER_IDS = BANKED_LAYER_SPECS.filter(
  (spec) => 'source' in spec && spec.source === SRC_HIT_FEATURES,
)
  .map((spec) => spec.id)
  .sort();

interface ResolvedBankIdentity {
  readonly bank: 'a' | 'b';
  readonly revision: string;
  readonly visibleLayerIds: readonly string[];
  readonly visibleSourceIds: readonly string[];
  readonly hitSourceId: string;
  readonly hitLayerIds: readonly string[];
  readonly featureStateSourceIds: readonly string[];
}

function physicalBank(id: string): 'a' | 'b' | undefined {
  if (id.endsWith('--bank-a')) return 'a';
  if (id.endsWith('--bank-b')) return 'b';
  return undefined;
}

function validUniqueStrings(entry: unknown): entry is string[] {
  return (
    Array.isArray(entry) &&
    entry.length > 0 &&
    entry.every((id) => typeof id === 'string') &&
    new Set(entry).size === entry.length
  );
}

function validBankIdentity(value: unknown): value is RendererLodAcceptanceBankIdentity {
  const candidate = record(value);
  return (
    !!candidate &&
    typeof candidate.activeRevision === 'string' &&
    candidate.activeRevision.length > 0 &&
    validUniqueStrings(candidate.visibleLayerIds) &&
    validUniqueStrings(candidate.visibleSourceIds) &&
    typeof candidate.hitSourceId === 'string' &&
    validUniqueStrings(candidate.hitLayerIds) &&
    validUniqueStrings(candidate.featureStateSourceIds)
  );
}

function resolveBankIdentity(
  identity: RendererLodAcceptanceBankIdentity,
): ResolvedBankIdentity | undefined {
  const ids = [
    ...identity.visibleLayerIds,
    ...identity.visibleSourceIds,
    identity.hitSourceId,
    ...identity.hitLayerIds,
    ...identity.featureStateSourceIds,
  ];
  const banks = new Set(ids.map(physicalBank));
  const bank = [...banks][0];
  if (banks.size !== 1 || !bank) return undefined;
  return {
    bank,
    revision: identity.activeRevision,
    visibleLayerIds: [...new Set(identity.visibleLayerIds)].sort(),
    visibleSourceIds: [...new Set(identity.visibleSourceIds)].sort(),
    hitSourceId: identity.hitSourceId,
    hitLayerIds: [...new Set(identity.hitLayerIds)].sort(),
    featureStateSourceIds: [...new Set(identity.featureStateSourceIds)].sort(),
  };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function logicalId(id: string): string {
  return id.replace(/--bank-[ab]$/, '');
}

function logicalIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map(logicalId))].sort();
}

function samePhysicalBankEvidence(
  left: ResolvedBankIdentity,
  right: ResolvedBankIdentity,
): boolean {
  return (
    left.bank === right.bank &&
    left.revision === right.revision &&
    sameStrings(left.visibleLayerIds, right.visibleLayerIds) &&
    sameStrings(left.visibleSourceIds, right.visibleSourceIds) &&
    left.hitSourceId === right.hitSourceId &&
    sameStrings(left.hitLayerIds, right.hitLayerIds) &&
    sameStrings(left.featureStateSourceIds, right.featureStateSourceIds)
  );
}

function sameLogicalBankEvidence(left: ResolvedBankIdentity, right: ResolvedBankIdentity): boolean {
  return (
    sameStrings(logicalIds(left.visibleLayerIds), logicalIds(right.visibleLayerIds)) &&
    sameStrings(logicalIds(left.visibleSourceIds), logicalIds(right.visibleSourceIds)) &&
    logicalId(left.hitSourceId) === logicalId(right.hitSourceId) &&
    sameStrings(logicalIds(left.hitLayerIds), logicalIds(right.hitLayerIds)) &&
    sameStrings(logicalIds(left.featureStateSourceIds), logicalIds(right.featureStateSourceIds))
  );
}

function hasExactCommittedIdentitySets(identity: ResolvedBankIdentity): boolean {
  return (
    sameStrings(logicalIds(identity.visibleLayerIds), EXPECTED_VISIBLE_LAYER_IDS) &&
    sameStrings(logicalIds(identity.visibleSourceIds), EXPECTED_VISIBLE_SOURCE_IDS) &&
    logicalId(identity.hitSourceId) === SRC_HIT_FEATURES &&
    sameStrings(logicalIds(identity.hitLayerIds), EXPECTED_HIT_LAYER_IDS) &&
    logicalIds(identity.featureStateSourceIds).every((id) => EXPECTED_VISIBLE_SOURCE_ID_SET.has(id))
  );
}

function bankAssertionErrors(assertion: Record<string, unknown>): string[] {
  if (
    assertion.kind !== 'bank-identity' ||
    !validBankIdentity(assertion.before) ||
    !validBankIdentity(assertion.duringPreparation) ||
    !validBankIdentity(assertion.afterPromotion)
  ) {
    return ['Acceptance bank assertion has invalid identity provenance.'];
  }
  const before = resolveBankIdentity(assertion.before);
  const during = resolveBankIdentity(assertion.duringPreparation);
  const after = resolveBankIdentity(assertion.afterPromotion);
  if (!before || !during || !after) {
    return ['Acceptance bank assertion observed mixed visible and interaction identity.'];
  }
  const errors: string[] = [];
  if (![before, during, after].every(hasExactCommittedIdentitySets)) {
    errors.push('Acceptance bank assertion does not contain the exact committed identity sets.');
  }
  if (!samePhysicalBankEvidence(before, during)) {
    errors.push('Acceptance bank assertion changed active IDs during hidden preparation.');
  }
  if (before.bank === after.bank || before.revision === after.revision) {
    errors.push('Acceptance bank assertion did not promote to a new bank and revision.');
  }
  if (!sameLogicalBankEvidence(before, after)) {
    errors.push('Acceptance bank assertion changed logical IDs during promotion.');
  }
  return errors;
}

function appliedHover(value: Record<string, unknown> | undefined): boolean {
  return (
    value?.kind === 'hover-feature-state' &&
    typeof value.sourceId === 'string' &&
    physicalBank(value.sourceId) !== undefined &&
    typeof value.featureId === 'string' &&
    value.featureId.length > 0 &&
    value.hover === true
  );
}

function appliedFilter(value: Record<string, unknown> | undefined): boolean {
  return (
    value?.kind === 'way-type-filter' &&
    value.wayTypeId === 'road' &&
    value.beforeChecked === true &&
    value.afterChecked === false &&
    typeof value.beforeFilterSha256 === 'string' &&
    SHA_256.test(value.beforeFilterSha256) &&
    typeof value.afterFilterSha256 === 'string' &&
    SHA_256.test(value.afterFilterSha256) &&
    value.beforeFilterSha256 !== value.afterFilterSha256
  );
}

function appliedTheme(value: Record<string, unknown> | undefined): boolean {
  return (
    value?.kind === 'map-scheme' &&
    value.before === 'light' &&
    value.after === 'dark' &&
    value.overlayHealthy === true
  );
}

function appliedActionError(id: string, observation: unknown): string | null {
  const value = record(observation);
  if (id === 'hover-zero-committed-work') {
    return appliedHover(value)
      ? null
      : 'Acceptance hover assertion does not prove applied feature state.';
  }
  if (id === 'filter-zero-committed-work') {
    return appliedFilter(value)
      ? null
      : 'Acceptance filter assertion does not prove an applied same-view filter change.';
  }
  if (id === 'retained-theme-zero-committed-work') {
    return appliedTheme(value)
      ? null
      : 'Acceptance theme assertion does not prove an applied healthy dark map.';
  }
  return null;
}

function statsAssertionErrors(id: string, assertion: Record<string, unknown>): string[] {
  if (
    assertion.kind !== 'renderer-stats' ||
    !validStats(assertion.before) ||
    !validStats(assertion.after) ||
    !validStats(assertion.delta)
  ) {
    return [`Acceptance assertion ${id} has invalid renderer-stat provenance.`];
  }
  const errors: string[] = [];
  const measured = computedDelta(assertion.before, assertion.after);
  if (!statsEqual(assertion.delta, measured)) {
    errors.push(`Acceptance assertion ${id} has a fabricated stats delta.`);
  }
  const actionError = appliedActionError(id, assertion.observation);
  if (actionError) errors.push(actionError);
  if (
    ZERO_COMMITTED_ASSERTIONS.has(id) &&
    (measured.projectionCount !== 0 ||
      measured.fullUploadCount !== 0 ||
      measured.sourceUploadCount !== 0)
  ) {
    errors.push(`Acceptance assertion ${id} does not prove zero committed work.`);
  }
  if (id === 'invalidating-camera-reprojects' && measured.projectionCount <= 0) {
    errors.push('Acceptance invalidating-camera assertion does not prove a new projection.');
  }
  return errors;
}

function invalidAssertionError(id: string, assertion: Record<string, unknown>): string | null {
  return typeof assertion.action !== 'string' ||
    assertion.action.length === 0 ||
    !validFixture(assertion.fixture) ||
    !validCamera(assertion.camera)
    ? `Acceptance assertion ${id} has invalid action provenance.`
    : null;
}

export function assertionErrors(assertions: unknown[]): string[] {
  const errors: string[] = [];
  if (!exactIdSet(assertions, RENDERER_LOD_ACCEPTANCE_ASSERTION_IDS)) {
    errors.push('Acceptance assertions must contain the exact machine-assertion ID set.');
  }
  for (const raw of assertions) {
    const assertion = record(raw);
    const id = typeof assertion?.id === 'string' ? assertion.id : '<invalid>';
    if (!assertion || !ASSERTION_IDS.has(id)) continue;
    const invalid = invalidAssertionError(id, assertion);
    if (invalid) {
      errors.push(invalid);
      continue;
    }
    if (assertion.passed !== true) {
      errors.push(`Acceptance assertion ${id} did not pass.`);
      continue;
    }
    errors.push(
      ...(id === 'bank-promotion-is-atomic'
        ? bankAssertionErrors(assertion)
        : statsAssertionErrors(id, assertion)),
    );
  }
  return errors;
}
