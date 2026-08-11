import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  RENDERER_LOD_ACCEPTANCE_ASSERTION_IDS,
  RENDERER_LOD_ACCEPTANCE_VISUAL_CASES,
  type RendererLodAcceptanceCamera,
} from '../../src/perf/renderer-lod-acceptance';
import { isBankedRenderLayer } from '../../src/map/source-bank-layers';
import { SRC_HIT_FEATURES } from '../../src/map/layers';
import { LIGHT_LAYER_SPECS } from '../../src/map/layers/layerSpecs';
import { COMMITTED_SYSTEM_FEATURE_SOURCES } from '../../src/map/system-feature-sources';
import type { RendererCaptureManifest } from './capture-types';
import type {
  RendererLodAcceptanceBankIdentity,
  RendererLodAcceptanceManifest,
  RendererLodAcceptanceStatsSnapshot,
} from './lod-acceptance-types';
import { rendererCaptureDigest } from './lifecycle';

const SHA_256 = /^[a-f0-9]{64}$/;
const STAT_KEYS = [
  'projectionCount',
  'fullUploadCount',
  'sourceUploadCount',
  'editorProjectionCount',
  'editorSourceUploadCount',
] as const satisfies readonly (keyof RendererLodAcceptanceStatsSnapshot)[];
const ZERO_COMMITTED_ASSERTIONS = new Set([
  'hover-zero-committed-work',
  'selection-zero-committed-work',
  'filter-zero-committed-work',
  'retained-theme-zero-committed-work',
  'accepted-camera-reuses-scene',
]);
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

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactIdSet(entries: unknown[], expected: readonly string[]): boolean {
  const ids = entries.map((entry) => record(entry)?.id).filter((id): id is string => !!id);
  return (
    ids.length === expected.length &&
    new Set(ids).size === expected.length &&
    expected.every((id) => ids.includes(id))
  );
}

function validSource(source: unknown): source is RendererCaptureManifest['source'] {
  const candidate = record(source);
  return (
    !!candidate &&
    typeof candidate.revision === 'string' &&
    /^[a-f0-9]{40}$/.test(candidate.revision) &&
    typeof candidate.dirty === 'boolean' &&
    typeof candidate.contentSha256 === 'string' &&
    SHA_256.test(candidate.contentSha256)
  );
}

function sameSource(
  source: RendererCaptureManifest['source'],
  expected: RendererCaptureManifest['source'],
): boolean {
  return (
    source.revision === expected.revision &&
    source.dirty === expected.dirty &&
    source.contentSha256 === expected.contentSha256
  );
}

function validStats(value: unknown): value is RendererLodAcceptanceStatsSnapshot {
  const candidate = record(value);
  return (
    !!candidate &&
    STAT_KEYS.every((key) => Number.isInteger(candidate[key]) && Number(candidate[key]) >= 0)
  );
}

function validCamera(value: unknown, expected?: RendererLodAcceptanceCamera): boolean {
  const candidate = record(value);
  const center = candidate?.center;
  const viewport = record(candidate?.viewport);
  if (
    !candidate ||
    !Array.isArray(center) ||
    center.length !== 2 ||
    !center.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)) ||
    typeof candidate.zoom !== 'number' ||
    !Number.isFinite(candidate.zoom) ||
    !viewport ||
    !Number.isInteger(viewport.width) ||
    Number(viewport.width) <= 0 ||
    !Number.isInteger(viewport.height) ||
    Number(viewport.height) <= 0 ||
    typeof viewport.pixelRatio !== 'number' ||
    !Number.isFinite(viewport.pixelRatio) ||
    Number(viewport.pixelRatio) <= 0
  ) {
    return false;
  }
  if (!expected) return true;
  return (
    center[0] === expected.center[0] &&
    center[1] === expected.center[1] &&
    candidate.zoom === expected.zoom &&
    viewport.width === expected.viewport.width &&
    viewport.height === expected.viewport.height &&
    viewport.pixelRatio === expected.viewport.pixelRatio &&
    candidate.targetCorridorWidthPx === expected.targetCorridorWidthPx
  );
}

function validMovingCamera(value: unknown, expected: RendererLodAcceptanceCamera): boolean {
  if (!validCamera(value)) return false;
  const candidate = value as RendererLodAcceptanceCamera;
  return (
    candidate.zoom === expected.zoom &&
    candidate.viewport.width === expected.viewport.width &&
    candidate.viewport.height === expected.viewport.height &&
    candidate.viewport.pixelRatio === expected.viewport.pixelRatio &&
    candidate.targetCorridorWidthPx === expected.targetCorridorWidthPx &&
    Math.hypot(
      candidate.center[0] - expected.center[0],
      candidate.center[1] - expected.center[1],
    ) <= 0.02
  );
}

function validFixture(value: unknown, expectedId?: string): boolean {
  const candidate = record(value);
  return (
    !!candidate &&
    typeof candidate.id === 'string' &&
    (!expectedId || candidate.id === expectedId) &&
    typeof candidate.documentId === 'string' &&
    candidate.documentId.length > 0 &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt)
  );
}

function computedDelta(
  before: RendererLodAcceptanceStatsSnapshot,
  after: RendererLodAcceptanceStatsSnapshot,
): RendererLodAcceptanceStatsSnapshot {
  return Object.fromEntries(
    STAT_KEYS.map((key) => [key, after[key] - before[key]]),
  ) as unknown as RendererLodAcceptanceStatsSnapshot;
}

function statsEqual(
  left: RendererLodAcceptanceStatsSnapshot,
  right: RendererLodAcceptanceStatsSnapshot,
): boolean {
  return STAT_KEYS.every((key) => left[key] === right[key]);
}

interface ResolvedBankIdentity {
  bank: 'a' | 'b';
  revision: string;
  visibleLayerIds: string[];
  visibleSourceIds: string[];
  hitSourceId: string;
  hitLayerIds: string[];
  featureStateSourceIds: string[];
}

function physicalBank(id: string): 'a' | 'b' | undefined {
  if (id.endsWith('--bank-a')) return 'a';
  if (id.endsWith('--bank-b')) return 'b';
  return undefined;
}

function validBankIdentity(value: unknown): value is RendererLodAcceptanceBankIdentity {
  const candidate = record(value);
  const uniqueStrings = (entry: unknown): entry is string[] =>
    Array.isArray(entry) &&
    entry.length > 0 &&
    entry.every((id) => typeof id === 'string') &&
    new Set(entry).size === entry.length;
  return (
    !!candidate &&
    typeof candidate.activeRevision === 'string' &&
    candidate.activeRevision.length > 0 &&
    uniqueStrings(candidate.visibleLayerIds) &&
    uniqueStrings(candidate.visibleSourceIds) &&
    typeof candidate.hitSourceId === 'string' &&
    uniqueStrings(candidate.hitLayerIds) &&
    uniqueStrings(candidate.featureStateSourceIds)
  );
}

function resolveBankIdentity(
  identity: RendererLodAcceptanceBankIdentity,
): ResolvedBankIdentity | undefined {
  const physicalIds = [
    ...identity.visibleLayerIds,
    ...identity.visibleSourceIds,
    identity.hitSourceId,
    ...identity.hitLayerIds,
    ...identity.featureStateSourceIds,
  ];
  const banks = new Set(physicalIds.map(physicalBank));
  const bank = [...banks][0];
  return banks.size === 1 && bank
    ? {
        bank,
        revision: identity.activeRevision,
        visibleLayerIds: [...new Set(identity.visibleLayerIds)].sort(),
        visibleSourceIds: [...new Set(identity.visibleSourceIds)].sort(),
        hitSourceId: identity.hitSourceId,
        hitLayerIds: [...new Set(identity.hitLayerIds)].sort(),
        featureStateSourceIds: [...new Set(identity.featureStateSourceIds)].sort(),
      }
    : undefined;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameBankEvidence(left: ResolvedBankIdentity, right: ResolvedBankIdentity): boolean {
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

function logicalPhysicalId(id: string): string {
  return id.replace(/--bank-[ab]$/, '');
}

function logicalIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map(logicalPhysicalId))].sort();
}

function sameLogicalBankEvidence(
  before: ResolvedBankIdentity,
  after: ResolvedBankIdentity,
): boolean {
  return (
    sameStrings(logicalIds(before.visibleLayerIds), logicalIds(after.visibleLayerIds)) &&
    sameStrings(logicalIds(before.visibleSourceIds), logicalIds(after.visibleSourceIds)) &&
    logicalPhysicalId(before.hitSourceId) === logicalPhysicalId(after.hitSourceId) &&
    sameStrings(logicalIds(before.hitLayerIds), logicalIds(after.hitLayerIds)) &&
    sameStrings(logicalIds(before.featureStateSourceIds), logicalIds(after.featureStateSourceIds))
  );
}

function hasExactCommittedIdentitySets(identity: ResolvedBankIdentity): boolean {
  const featureStateIds = logicalIds(identity.featureStateSourceIds);
  return (
    sameStrings(logicalIds(identity.visibleLayerIds), EXPECTED_VISIBLE_LAYER_IDS) &&
    sameStrings(logicalIds(identity.visibleSourceIds), EXPECTED_VISIBLE_SOURCE_IDS) &&
    logicalPhysicalId(identity.hitSourceId) === SRC_HIT_FEATURES &&
    sameStrings(logicalIds(identity.hitLayerIds), EXPECTED_HIT_LAYER_IDS) &&
    featureStateIds.every((id) => EXPECTED_VISIBLE_SOURCE_ID_SET.has(id))
  );
}

function hasAppliedActionObservation(id: string, value: unknown): boolean {
  const observation = record(value);
  if (id === 'hover-zero-committed-work') {
    return (
      observation?.kind === 'hover-feature-state' &&
      typeof observation.sourceId === 'string' &&
      physicalBank(observation.sourceId) !== undefined &&
      typeof observation.featureId === 'string' &&
      observation.featureId.length > 0 &&
      observation.hover === true
    );
  }
  if (id === 'filter-zero-committed-work') {
    return (
      observation?.kind === 'way-type-filter' &&
      observation.wayTypeId === 'road' &&
      observation.beforeChecked === true &&
      observation.afterChecked === false &&
      typeof observation.beforeFilterSha256 === 'string' &&
      SHA_256.test(observation.beforeFilterSha256) &&
      typeof observation.afterFilterSha256 === 'string' &&
      SHA_256.test(observation.afterFilterSha256) &&
      observation.beforeFilterSha256 !== observation.afterFilterSha256
    );
  }
  if (id === 'retained-theme-zero-committed-work') {
    return (
      observation?.kind === 'map-scheme' &&
      observation.before === 'light' &&
      observation.after === 'dark' &&
      observation.overlayHealthy === true
    );
  }
  return true;
}

async function visualErrors(visuals: unknown[], acceptanceDirectory: string): Promise<string[]> {
  const errors: string[] = [];
  if (
    !exactIdSet(
      visuals,
      RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.map((entry) => entry.id),
    )
  ) {
    errors.push('Acceptance visuals must contain the exact 21-case ID set.');
  }
  const expectedById = new Map(
    RENDERER_LOD_ACCEPTANCE_VISUAL_CASES.map((entry) => [entry.id, entry]),
  );
  const seenFiles = new Set<string>();
  for (const raw of visuals) {
    const entry = record(raw);
    const id = typeof entry?.id === 'string' ? entry.id : '<invalid>';
    const expected = expectedById.get(id);
    if (!entry || !expected) continue;
    if (entry.file !== expected.file || seenFiles.has(String(entry.file))) {
      errors.push(`Acceptance visual ${id} must use its declared images path.`);
      continue;
    }
    seenFiles.add(expected.file);
    if (
      entry.fixtureId !== expected.fixtureId ||
      entry.surface !== expected.surface ||
      entry.state !== expected.state ||
      !validFixture(entry.fixture, expected.fixtureId) ||
      !(expected.state === 'moving'
        ? validMovingCamera(entry.camera, expected.camera)
        : validCamera(entry.camera, expected.camera)) ||
      !validStats(entry.rendererStats)
    ) {
      errors.push(`Acceptance visual ${id} has invalid capture provenance.`);
      continue;
    }
    if (typeof entry.sha256 !== 'string' || !SHA_256.test(entry.sha256)) {
      errors.push(`Acceptance visual ${id} has an invalid SHA-256 digest.`);
      continue;
    }
    try {
      const bytes = await readFile(resolve(acceptanceDirectory, expected.file));
      if (rendererCaptureDigest(bytes) !== entry.sha256) {
        errors.push(`Acceptance visual ${id} hash does not match its file.`);
      }
    } catch {
      errors.push(`Acceptance visual ${id} file is missing.`);
    }
  }
  return errors;
}

function assertionErrors(assertions: unknown[]): string[] {
  const errors: string[] = [];
  if (!exactIdSet(assertions, RENDERER_LOD_ACCEPTANCE_ASSERTION_IDS)) {
    errors.push('Acceptance assertions must contain the exact machine-assertion ID set.');
  }
  for (const raw of assertions) {
    const assertion = record(raw);
    const id = typeof assertion?.id === 'string' ? assertion.id : '<invalid>';
    if (!assertion || !RENDERER_LOD_ACCEPTANCE_ASSERTION_IDS.includes(id as never)) continue;
    if (
      typeof assertion.action !== 'string' ||
      assertion.action.length === 0 ||
      !validFixture(assertion.fixture) ||
      !validCamera(assertion.camera)
    ) {
      errors.push(`Acceptance assertion ${id} has invalid action provenance.`);
      continue;
    }
    if (assertion.passed !== true) {
      errors.push(`Acceptance assertion ${id} did not pass.`);
      continue;
    }
    if (id === 'bank-promotion-is-atomic') {
      if (
        assertion.kind !== 'bank-identity' ||
        !validBankIdentity(assertion.before) ||
        !validBankIdentity(assertion.duringPreparation) ||
        !validBankIdentity(assertion.afterPromotion)
      ) {
        errors.push('Acceptance bank assertion has invalid identity provenance.');
        continue;
      }
      const before = resolveBankIdentity(assertion.before);
      const duringPreparation = resolveBankIdentity(assertion.duringPreparation);
      const afterPromotion = resolveBankIdentity(assertion.afterPromotion);
      if (!before || !duringPreparation || !afterPromotion) {
        errors.push('Acceptance bank assertion observed mixed visible and interaction identity.');
      } else {
        if (
          !hasExactCommittedIdentitySets(before) ||
          !hasExactCommittedIdentitySets(duringPreparation) ||
          !hasExactCommittedIdentitySets(afterPromotion)
        ) {
          errors.push(
            'Acceptance bank assertion does not contain the exact committed identity sets.',
          );
        }
        if (!sameBankEvidence(before, duringPreparation)) {
          errors.push('Acceptance bank assertion changed active IDs during hidden preparation.');
        }
        if (before.bank === afterPromotion.bank || before.revision === afterPromotion.revision) {
          errors.push('Acceptance bank assertion did not promote to a new bank and revision.');
        }
        if (!sameLogicalBankEvidence(before, afterPromotion)) {
          errors.push('Acceptance bank assertion changed logical IDs during promotion.');
        }
      }
      continue;
    }
    if (
      assertion.kind !== 'renderer-stats' ||
      !validStats(assertion.before) ||
      !validStats(assertion.after) ||
      !validStats(assertion.delta)
    ) {
      errors.push(`Acceptance assertion ${id} has invalid renderer-stat provenance.`);
      continue;
    }
    const measured = computedDelta(assertion.before, assertion.after);
    if (!statsEqual(assertion.delta, measured)) {
      errors.push(`Acceptance assertion ${id} has a fabricated stats delta.`);
      continue;
    }
    if (!hasAppliedActionObservation(id, assertion.observation)) {
      if (id === 'hover-zero-committed-work') {
        errors.push('Acceptance hover assertion does not prove applied feature state.');
      } else if (id === 'filter-zero-committed-work') {
        errors.push(
          'Acceptance filter assertion does not prove an applied same-view filter change.',
        );
      } else if (id === 'retained-theme-zero-committed-work') {
        errors.push('Acceptance theme assertion does not prove an applied healthy dark map.');
      }
    }
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
  }
  return errors;
}

/** Returns every integrity defect so a failed capture is diagnostic rather
 * than silently omitted from canonical renderer history. */
export async function validateRendererLodAcceptanceManifest(
  manifest: unknown,
  acceptanceDirectory: string,
  expectedSource: RendererCaptureManifest['source'],
): Promise<string[]> {
  const candidate = record(manifest);
  if (!candidate) return ['Acceptance manifest must be an object.'];
  const errors: string[] = [];
  if (
    candidate.schemaVersion !== 1 ||
    candidate.suiteId !== 'phase-2-lod' ||
    candidate.phase !== '01-lod' ||
    candidate.basemap !== 'local-blank-v2' ||
    typeof candidate.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.generatedAt))
  ) {
    errors.push('Acceptance manifest header is invalid.');
  }
  if (!validSource(candidate.source) || !sameSource(candidate.source, expectedSource)) {
    errors.push('Acceptance source provenance must match the parent renderer manifest.');
  }
  if (!Array.isArray(candidate.visuals)) {
    errors.push('Acceptance visuals must be an array.');
  } else {
    errors.push(...(await visualErrors(candidate.visuals, acceptanceDirectory)));
  }
  if (!Array.isArray(candidate.assertions)) {
    errors.push('Acceptance assertions must be an array.');
  } else {
    errors.push(...assertionErrors(candidate.assertions));
  }
  return errors;
}

export async function loadValidRendererLodAcceptanceManifest(
  acceptanceDirectory: string,
  expectedSource: RendererCaptureManifest['source'],
): Promise<RendererLodAcceptanceManifest | undefined> {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(acceptanceDirectory, 'manifest.json'), 'utf8'),
    ) as unknown;
    return (
      await validateRendererLodAcceptanceManifest(manifest, acceptanceDirectory, expectedSource)
    ).length === 0
      ? (manifest as RendererLodAcceptanceManifest)
      : undefined;
  } catch {
    return undefined;
  }
}
