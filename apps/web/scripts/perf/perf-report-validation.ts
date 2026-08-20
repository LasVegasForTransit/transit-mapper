import type { PerfReport } from '../../src/perf/types';
import { validateFixedPerfProtocol } from './perf-protocol-validation';

type UnknownRecord = Record<string, unknown>;

const JOURNEYS = new Set([
  'new-user-editor',
  'public-share',
  'cross-site-embed',
  'n-minus-one-update',
]);
const SURFACES = new Set(['editor', 'share', 'embed']);
const CACHE_STATES = new Set(['cold', 'http-warm', 'service-worker-warm', 'n-minus-one']);
const TARGETS = new Set(['page', 'iframe', 'dedicated-worker', 'service-worker']);
const CATEGORIES = new Set([
  'first-party-application',
  'external-map',
  'document-data',
  'service-worker',
  'telemetry',
  'other',
]);
const CACHE_SOURCES = new Set([
  'network',
  'disk',
  'memory-or-disk',
  'prefetch',
  'service-worker',
  'unknown',
]);
const COMPRESSIONS = new Set(['identity', 'gzip', 'br', 'zstd', 'other']);
const RENDER_BLOCKING = new Set(['blocking', 'non-blocking', 'unknown']);
const ATTRIBUTION_SOURCES = new Set(['resource-timing', 'cdp']);
const BYTE_AUTHORITIES = new Set(['loading-finished']);
const PHASES = new Set([
  'document',
  'shell',
  'documentReady',
  'firstSystemPaint',
  'interactionReady',
  'networkIdle',
  'serviceWorkerReady',
  'automaticBoundary',
  'nMinusOneUpdate',
]);
const AUDIT_PHASES = new Set(['instrumented', 'first-session', 'onboarding']);
const AUDIT_PHASE_STATUSES = new Set(['passed', 'failed', 'unavailable']);
const MILESTONES = [
  'documentResponseEndMs',
  'bootstrapStartMs',
  'shellMountedMs',
  'storageReadStartMs',
  'storageReadEndMs',
  'deserializeStartMs',
  'deserializeEndMs',
  'systemCommittedMs',
  'mapStyleReadyMs',
  'firstSystemPaintMs',
  'interactiveMs',
  'networkIdleMs',
  'serviceWorkerReadyMs',
] as const;
const REQUIRED_FIRST_SESSION_PHASES = [
  'document',
  'shell',
  'documentReady',
  'firstSystemPaint',
  'interactionReady',
  'networkIdle',
  'automaticBoundary',
] as const;
const SURFACE_BY_JOURNEY: Record<string, string> = {
  'new-user-editor': 'editor',
  'public-share': 'share',
  'cross-site-embed': 'embed',
  'n-minus-one-update': 'editor',
};
const REQUIRED_COLD_JOURNEYS = ['new-user-editor', 'public-share', 'cross-site-embed'] as const;
const BREAKDOWN_CATEGORIES = [
  'firstPartyApplication',
  'externalMap',
  'documentData',
  'serviceWorker',
  'telemetry',
  'other',
] as const;
const BREAKDOWN_KEY_BY_CATEGORY: Record<string, (typeof BREAKDOWN_CATEGORIES)[number]> = {
  'first-party-application': 'firstPartyApplication',
  'external-map': 'externalMap',
  'document-data': 'documentData',
  'service-worker': 'serviceWorker',
  telemetry: 'telemetry',
  other: 'other',
};

function invalid(reportPath: string, detail: string): never {
  throw new Error(`Frozen PerfReport "${reportPath}" is invalid: ${detail}.`);
}

function record(value: unknown, reportPath: string, context: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(reportPath, `${context} must be an object`);
  }
  return value as UnknownRecord;
}

function array(value: unknown, reportPath: string, context: string): unknown[] {
  if (!Array.isArray(value)) invalid(reportPath, `${context} must be an array`);
  return value;
}

function stringValue(value: unknown, reportPath: string, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    invalid(reportPath, `${context} must be a non-empty string`);
  }
  return value;
}

function finiteNumber(value: unknown, reportPath: string, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    invalid(reportPath, `${context} must be a finite non-negative number`);
  }
  return value;
}

function signedFiniteNumber(value: unknown, reportPath: string, context: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(reportPath, `${context} must be a finite number`);
  }
  return value;
}

function byteCount(value: unknown, reportPath: string, context: string): number {
  const result = finiteNumber(value, reportPath, context);
  if (!Number.isSafeInteger(result)) {
    invalid(reportPath, `${context} must be a non-negative safe integer`);
  }
  return result;
}

function enumValue(
  value: unknown,
  allowed: ReadonlySet<string>,
  reportPath: string,
  context: string,
): void {
  if (typeof value !== 'string' || !allowed.has(value)) {
    invalid(reportPath, `${context} has an unsupported value`);
  }
}

function validateBundles(value: unknown, reportPath: string): void {
  for (const [index, candidate] of array(value, reportPath, 'bundles').entries()) {
    const bundle = record(candidate, reportPath, `bundles[${index}]`);
    stringValue(bundle.entry, reportPath, `bundles[${index}].entry`);
    for (const key of ['rawBytes', 'gzipBytes', 'brotliBytes']) {
      byteCount(bundle[key], reportPath, `bundles[${index}].${key}`);
    }
  }
}

function validateProvenance(value: unknown, reportPath: string): void {
  if (value === undefined) return;
  const provenance = record(value, reportPath, 'provenance');
  const artifactRevision = stringValue(
    provenance.artifactRevision,
    reportPath,
    'provenance.artifactRevision',
  );
  const milestoneMarkSource = provenance.milestoneMarkSource;
  if (milestoneMarkSource !== 'shipping' && milestoneMarkSource !== 'legacy-497a549-observer-v1') {
    invalid(reportPath, 'provenance.milestoneMarkSource is unsupported');
  }
  if (milestoneMarkSource === 'legacy-497a549-observer-v1' && artifactRevision !== '497a549') {
    invalid(reportPath, 'legacy observer provenance requires 497a549');
  }
}

function validateByteTotals(value: unknown, reportPath: string, context: string): UnknownRecord {
  const totals = record(value, reportPath, context);
  byteCount(totals.encodedBytes, reportPath, `${context}.encodedBytes`);
  byteCount(totals.decodedBytes, reportPath, `${context}.decodedBytes`);
  byteCount(totals.requestCount, reportPath, `${context}.requestCount`);
  return totals;
}

function validateBreakdown(value: unknown, reportPath: string, context: string): UnknownRecord {
  const breakdown = record(value, reportPath, context);
  const categories = BREAKDOWN_CATEGORIES.map((key) =>
    validateByteTotals(breakdown[key], reportPath, `${context}.${key}`),
  );
  const total = validateByteTotals(breakdown.total, reportPath, `${context}.total`);
  for (const metric of ['encodedBytes', 'decodedBytes', 'requestCount']) {
    const calculated = categories.reduce((sum, category) => sum + Number(category[metric]), 0);
    if (total[metric] !== calculated) {
      invalid(reportPath, `${context}.total.${metric} does not equal its category sum`);
    }
  }
  return breakdown;
}

function validateNetworkRequest(
  value: unknown,
  reportPath: string,
  context: string,
): UnknownRecord {
  const request = record(value, reportPath, context);
  stringValue(request.url, reportPath, `${context}.url`);
  enumValue(request.category, CATEGORIES, reportPath, `${context}.category`);
  enumValue(request.target, TARGETS, reportPath, `${context}.target`);
  for (const key of ['initiator', 'contentType', 'protocol']) {
    if (typeof request[key] !== 'string') invalid(reportPath, `${context}.${key} must be a string`);
  }
  enumValue(request.cacheSource, CACHE_SOURCES, reportPath, `${context}.cacheSource`);
  enumValue(request.compression, COMPRESSIONS, reportPath, `${context}.compression`);
  enumValue(
    request.renderBlockingStatus,
    RENDER_BLOCKING,
    reportPath,
    `${context}.renderBlockingStatus`,
  );
  enumValue(
    request.attributionSource,
    ATTRIBUTION_SOURCES,
    reportPath,
    `${context}.attributionSource`,
  );
  enumValue(request.byteAuthority, BYTE_AUTHORITIES, reportPath, `${context}.byteAuthority`);
  byteCount(request.encodedBytes, reportPath, `${context}.encodedBytes`);
  byteCount(request.decodedBytes, reportPath, `${context}.decodedBytes`);
  signedFiniteNumber(request.startedAtMs, reportPath, `${context}.startedAtMs`);
  if (request.completedAtMs !== null) {
    signedFiniteNumber(request.completedAtMs, reportPath, `${context}.completedAtMs`);
  }
  return request;
}

function validateRequestTotals(
  requests: readonly UnknownRecord[],
  breakdown: UnknownRecord,
  reportPath: string,
  context: string,
): void {
  const empty = () => ({ encodedBytes: 0, decodedBytes: 0, requestCount: 0 });
  const sums: Record<(typeof BREAKDOWN_CATEGORIES)[number], Record<string, number>> = {
    firstPartyApplication: empty(),
    externalMap: empty(),
    documentData: empty(),
    serviceWorker: empty(),
    telemetry: empty(),
    other: empty(),
  };
  for (const request of requests) {
    const key = BREAKDOWN_KEY_BY_CATEGORY[String(request.category)];
    sums[key].encodedBytes += Number(request.encodedBytes);
    sums[key].decodedBytes += Number(request.decodedBytes);
    sums[key].requestCount += 1;
  }
  for (const key of BREAKDOWN_CATEGORIES) {
    const actual = record(breakdown[key], reportPath, `${context}.total.${key}`);
    for (const metric of ['encodedBytes', 'decodedBytes', 'requestCount']) {
      if (actual[metric] !== sums[key][metric]) {
        invalid(
          reportPath,
          `${context}.total.${key}.${metric} does not equal its authoritative request sum`,
        );
      }
    }
  }
}

function validateRequiredPhases(
  phases: UnknownRecord,
  surface: string,
  reportPath: string,
  context: string,
): void {
  const required =
    surface === 'editor'
      ? [...REQUIRED_FIRST_SESSION_PHASES, 'serviceWorkerReady']
      : REQUIRED_FIRST_SESSION_PHASES;
  for (const name of required) {
    if (phases[name] === undefined) invalid(reportPath, `${context}.phases.${name} is required`);
  }
}

function validateNetwork(
  value: unknown,
  reportPath: string,
  context: string,
  surface: string,
): void {
  const network = record(value, reportPath, context);
  if (network.authority !== 'cdp-network-encoded-data-length') {
    invalid(reportPath, `${context}.authority is not the CDP byte contract`);
  }
  finiteNumber(network.automaticBoundaryMs, reportPath, `${context}.automaticBoundaryMs`);
  if (network.automaticBoundaryMs !== 60_000) {
    invalid(reportPath, `${context}.automaticBoundaryMs must be 60000`);
  }
  if (typeof network.settled !== 'boolean') {
    invalid(reportPath, `${context}.settled must be a boolean`);
  }
  byteCount(
    network.unsettledNonMapRequestCount,
    reportPath,
    `${context}.unsettledNonMapRequestCount`,
  );
  if (!network.settled || network.unsettledNonMapRequestCount !== 0) {
    invalid(reportPath, `${context} must be settled`);
  }
  const requests = array(network.requests, reportPath, `${context}.requests`).map(
    (request, index) =>
      validateNetworkRequest(request, reportPath, `${context}.requests[${index}]`),
  );
  const phases = record(network.phases, reportPath, `${context}.phases`);
  for (const [name, phaseValue] of Object.entries(phases)) {
    if (!PHASES.has(name)) invalid(reportPath, `${context}.phases.${name} is unsupported`);
    const phase = record(phaseValue, reportPath, `${context}.phases.${name}`);
    finiteNumber(phase.atMs, reportPath, `${context}.phases.${name}.atMs`);
    validateBreakdown(phase.bytes, reportPath, `${context}.phases.${name}.bytes`);
  }
  validateRequiredPhases(phases, surface, reportPath, context);
  const total = validateBreakdown(network.total, reportPath, `${context}.total`);
  validateRequestTotals(requests, total, reportPath, context);
}

function validateFirstSessions(value: unknown, reportPath: string): void {
  const samples = array(value, reportPath, 'firstSessions');
  const seen = new Set<string>();
  for (const [index, candidate] of samples.entries()) {
    const context = `firstSessions[${index}]`;
    const sample = record(candidate, reportPath, context);
    enumValue(sample.journey, JOURNEYS, reportPath, `${context}.journey`);
    enumValue(sample.surface, SURFACES, reportPath, `${context}.surface`);
    enumValue(sample.cacheState, CACHE_STATES, reportPath, `${context}.cacheState`);
    const journey = String(sample.journey);
    const surface = String(sample.surface);
    const cacheState = String(sample.cacheState);
    if (surface !== SURFACE_BY_JOURNEY[journey]) {
      invalid(reportPath, `${journey} must use the ${SURFACE_BY_JOURNEY[journey]} surface`);
    }
    const key = `${cacheState}:${journey}`;
    if (seen.has(key)) invalid(reportPath, `duplicate ${cacheState} ${journey} sample`);
    seen.add(key);
    const milestones = record(sample.milestones, reportPath, `${context}.milestones`);
    for (const milestone of MILESTONES) {
      if (milestones[milestone] !== null) {
        finiteNumber(milestones[milestone], reportPath, `${context}.milestones.${milestone}`);
      }
    }
    validateNetwork(sample.network, reportPath, `${context}.network`, surface);
  }
  for (const journey of REQUIRED_COLD_JOURNEYS) {
    const count = samples.filter((candidate) => {
      const sample = record(candidate, reportPath, 'firstSessions sample');
      return sample.journey === journey && sample.cacheState === 'cold';
    }).length;
    if (count !== 1)
      invalid(reportPath, `firstSessions must contain exactly one cold ${journey} sample`);
  }
}

function validateJsonMetrics(value: unknown, reportPath: string, context: string): void {
  if (typeof value === 'number') {
    finiteNumber(value, reportPath, context);
    return;
  }
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonMetrics(item, reportPath, `${context}[${index}]`));
    return;
  }
  const candidate = record(value, reportPath, context);
  for (const [key, item] of Object.entries(candidate)) {
    validateJsonMetrics(item, reportPath, `${context}.${key}`);
  }
}

export function validateFrozenPerfReport(value: unknown, reportPath: string): PerfReport {
  const report = record(value, reportPath, 'report');
  if (report.schemaVersion !== 3) {
    throw new Error(`Frozen PerfReport "${reportPath}" must use schema version 3.`);
  }
  stringValue(report.generatedAt, reportPath, 'generatedAt');
  if (report.status !== 'ok' && report.status !== 'unavailable') {
    invalid(reportPath, 'status must be ok or unavailable');
  }
  if (report.status === 'unavailable') {
    stringValue(report.unavailableReason, reportPath, 'unavailableReason');
  }
  validateFixedPerfProtocol(report.protocol, reportPath);
  validateProvenance(report.provenance, reportPath);
  validateBundles(report.bundles, reportPath);
  if (report.phases !== undefined) {
    const phases = array(report.phases, reportPath, 'phases');
    const seen = new Set<string>();
    phases.forEach((candidate, index) => {
      const context = `phases[${index}]`;
      const phase = record(candidate, reportPath, context);
      enumValue(phase.phase, AUDIT_PHASES, reportPath, `${context}.phase`);
      enumValue(phase.status, AUDIT_PHASE_STATUSES, reportPath, `${context}.status`);
      const phaseName = String(phase.phase);
      if (seen.has(phaseName)) invalid(reportPath, `duplicate ${phaseName} phase`);
      seen.add(phaseName);
      if (phase.reason !== undefined) stringValue(phase.reason, reportPath, `${context}.reason`);
    });
  }
  validateFirstSessions(report.firstSessions, reportPath);
  validateJsonMetrics(array(report.samples, reportPath, 'samples'), reportPath, 'samples');
  validateJsonMetrics(array(report.scenarios, reportPath, 'scenarios'), reportPath, 'scenarios');
  if (report.calibration !== undefined) {
    validateJsonMetrics(report.calibration, reportPath, 'calibration');
  }
  if (report.evaluation !== undefined) {
    validateJsonMetrics(report.evaluation, reportPath, 'evaluation');
  }
  return report as unknown as PerfReport;
}
