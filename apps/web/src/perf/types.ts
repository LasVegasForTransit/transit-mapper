import type { PerfNetworkByteReport } from './network-byte-types';
import type { RendererStatsSnapshot } from '@transitmapper/renderer/stats';
import type { SourceUploadCount } from './source-uploads';

export type PerfFixtureId = 'small' | 'dense' | 'published' | 'rtc';
export type PerfScenarioId = 'small' | 'dense' | 'rtc' | 'share' | 'embed';
export type PerfSurface = 'editor' | 'share' | 'embed';
export type PerfProfileId = 'desktop' | 'mobile';
export type PerfRunMode = 'audit' | 'smoke';

export type PerfMetricName =
  | 'loadMs'
  | 'firstContentfulPaintMs'
  | 'largestContentfulPaintMs'
  | 'firstMapCanvasMs'
  | 'cumulativeLayoutShift'
  | 'longTaskTotalMs'
  | 'transferBytes'
  | 'inputToNextPaintP95Ms'
  | 'paintedFrameP95Ms'
  | 'paintedFramesOver33Ratio'
  | 'maxUnexpectedLongTaskMs'
  | 'warmLoadMs'
  | 'warmLargestContentfulPaintMs'
  | 'warmCumulativeLayoutShift'
  | 'warmInputToNextPaintP95Ms';

export interface PerfFixtureCounts {
  ways: number;
  points: number;
  stops: number;
  patterns: number;
}

export interface PerfAbsoluteBudgets {
  loadMs?: number;
  firstContentfulPaintMs?: number;
  largestContentfulPaintMs?: number;
  firstMapCanvasMs?: number;
  cumulativeLayoutShift?: number;
  longTaskTotalMs?: number;
  transferBytes?: number;
  inputToNextPaintP95Ms?: number;
  paintedFrameP95Ms?: number;
  /** This gate is exclusive: exactly 1% is a failure, not a pass. */
  paintedFramesOver33Ratio?: number;
  maxUnexpectedLongTaskMs?: number;
  warmLoadMs?: number;
  warmLargestContentfulPaintMs?: number;
  warmCumulativeLayoutShift?: number;
  warmInputToNextPaintP95Ms?: number;
}

export interface PerfScenario {
  id: PerfScenarioId;
  surface: PerfSurface;
  fixtureId: PerfFixtureId;
  label: string;
  description: string;
  path: string;
  readySelector: string;
  fixture: PerfFixtureCounts;
  absoluteBudgets: PerfAbsoluteBudgets;
}

export interface PerfViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

interface PerfNetworkProfile {
  name: 'Fast 4G';
  downloadThroughputBytesPerSecond: number;
  uploadThroughputBytesPerSecond: number;
  latencyMs: number;
}

export interface PerfProtocol {
  profile: PerfProfileId;
  browser: 'Google Chrome';
  browserChannel: 'chrome';
  headed: true;
  cpuThrottlingRate: 4;
  cache: 'cleared-before-cold-load-then-enabled';
  viewport: PerfViewport;
  network: PerfNetworkProfile;
  warmupRuns: number;
  measuredRuns: number;
  warmReloadsPerMeasuredRun: 1;
}

export interface PerfMetricValues {
  loadMs: number;
  firstContentfulPaintMs: number;
  largestContentfulPaintMs: number;
  firstMapCanvasMs: number;
  cumulativeLayoutShift: number;
  longTaskTotalMs: number;
  transferBytes: number;
  inputToNextPaintP95Ms: number;
  paintedFrameP95Ms: number;
  paintedFramesOver33Ratio: number;
  maxUnexpectedLongTaskMs: number;
  warmLoadMs: number;
  warmLargestContentfulPaintMs: number;
  warmCumulativeLayoutShift: number;
  warmInputToNextPaintP95Ms: number;
}

export interface PerfGestureDiagnostics {
  name: 'map-pan' | 'map-drag' | 'entity-drag-draw';
  frameSource: 'map-render' | 'animation-frame-proxy';
  /** Trusted pointer interactions observed through the Event Timing API. */
  inputToNextPaintMs: number[];
  paintedFrameMs: number[];
  unexpectedLongTaskMs: number[];
  actions: Array<'camera-drag' | 'entity-drag' | 'draw'>;
  simulationState: 'running' | 'paused' | 'not-applicable';
  /** Deterministic programmatic pan retained for attribution only. The hard
   * frame gate is always sourced from the trusted actions above. */
  scriptedPan?: {
    paintedFrameMs: number[];
    unexpectedLongTaskMs: number[];
    sourceUploadCount: number | null;
  };
}

export interface PerfRuntimeCounters {
  /** Null on the embed, which does not install the editor's source meter. */
  sourceUploadCount: number | null;
  /** Per-source attribution is absent from reports created before this field. */
  sourceUploads?: SourceUploadCount[] | null;
  paintedFrameCount: number;
  unexpectedLongTaskCount: number;
  domNodeCount: number;
  phaseCounters: PerfPhaseCounters | null;
}

export interface PerfPhaseCounters {
  fullProjectionCount: number;
  gestureProjectionCount: number;
  entityComparisonCount: number;
  projectedEntityCount: number;
}

export interface PerfNetworkSnapshot {
  requestCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  transferBytes: number;
}

export interface PerfMemorySnapshot {
  jsHeapUsedBytes: number;
  jsHeapTotalBytes: number;
}

export type PerfStorageWriteOutcome = 'stored' | 'quota-exceeded' | 'unavailable';

export interface PerfProductionPersistenceProbe {
  /** Draw commit through the durable IndexedDB transaction completing. */
  saveMs: number;
  /** The bounded cooperative document serialization lane. */
  serializationMs: number;
  /** The production read-write transaction against the document stores. */
  indexedDbWriteMs: number;
}

export interface PerfPersistenceProbe {
  /** Present only on editor journeys, which perform and prove a real save. */
  production?: PerfProductionPersistenceProbe;
  /** The remaining fields are a compatibility-boundary diagnostic. They are
   * not the production autosave path. */
  serializedBytes: number;
  parseMs: number;
  serializationMs: number;
  localStorageWriteMs: number;
  localStorageWriteOutcome: PerfStorageWriteOutcome;
  offThreadSerializationThresholdMs: number;
  indexedDbThresholdBytes: number;
  recommendOffThreadSerialization: boolean;
  recommendIndexedDb: boolean;
}

export interface PerfBundleEntry {
  entry: string;
  rawBytes: number;
  gzipBytes: number;
  brotliBytes: number;
}

export interface PerfSample {
  scenarioId: PerfScenarioId;
  /** Measured run number. The warm-up is deliberately absent from reports. */
  run: number;
  metrics: PerfMetricValues;
  gesture: PerfGestureDiagnostics;
  warmGesture: PerfGestureDiagnostics;
  counters: PerfRuntimeCounters;
  warmCounters: PerfRuntimeCounters;
  network: PerfNetworkSnapshot;
  warmNetwork: PerfNetworkSnapshot;
  memory: PerfMemorySnapshot;
  warmMemory: PerfMemorySnapshot;
  /** Cumulative renderer work for the cold document load and measured journey. */
  rendererStats: RendererStatsSnapshot | null;
  /** The equivalent snapshot after the warm reload and paused journey. */
  warmRendererStats: RendererStatsSnapshot | null;
  persistence: PerfPersistenceProbe;
  traceArtifact?: string;
}

export interface PerfMetricSummary {
  samples: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  variance: number;
  standardDeviation: number;
  coefficientOfVariation: number;
}

export interface PerfScenarioSummary {
  scenarioId: PerfScenarioId;
  label: string;
  fixture: PerfFixtureCounts;
  metrics: Record<PerfMetricName, PerfMetricSummary>;
  /**
   * Values used by absolute policy. Startup metrics use the five-run p95;
   * direct-manipulation gates aggregate their raw Event Timing/map samples.
   */
  gateValues: Record<PerfMetricName, number>;
  persistence: {
    productionSampleCount: number;
    productionSaveMs: PerfMetricSummary;
    productionSerializationMs: PerfMetricSummary;
    productionIndexedDbWriteMs: PerfMetricSummary;
    serializedBytes: number;
    parseMs: PerfMetricSummary;
    serializationMs: PerfMetricSummary;
    localStorageWriteMs: PerfMetricSummary;
    outcomes: Record<PerfStorageWriteOutcome, number>;
    recommendOffThreadSerialization: boolean;
    recommendIndexedDb: boolean;
  };
}

type PerfReportStatus = 'ok' | 'partial' | 'unavailable';

export type PerfAuditPhase = 'instrumented' | 'first-session' | 'onboarding';
export type PerfAuditPhaseStatus = 'passed' | 'failed' | 'unavailable';

export interface PerfAuditPhaseResult {
  phase: PerfAuditPhase;
  status: PerfAuditPhaseStatus;
  reason?: string;
}

export interface PerfOnboardingSample {
  slideCount: number;
  trustedClickCount: number;
  previewCanvasCount: number;
  webGlContextCount: number;
  mapReconstructionCount: number;
  remoteStyleRequests: string[];
  slideLongTasksMs: number[];
  maximumSlideLongTaskMs: number;
}

export interface PerfCalibration {
  benchmark: 'integer-mix-v1';
  samplesMs: number[];
  medianMs: number;
  /** Consecutive requestAnimationFrame intervals from the headed calibration
   * page. These describe the display environment and never normalize gates. */
  displayFrameIntervalSamplesMs: number[];
  displayFrameIntervalMedianMs: number;
  estimatedDisplayRefreshHz: number;
}

export type PerfFirstSessionJourney =
  'new-user-editor' | 'public-share' | 'cross-site-embed' | 'n-minus-one-update';
export type PerfCacheState = 'cold' | 'http-warm' | 'service-worker-warm' | 'n-minus-one';

export interface PerfFirstSessionMilestones {
  documentResponseEndMs: number;
  bootstrapStartMs: number | null;
  shellMountedMs: number | null;
  storageReadStartMs: number | null;
  storageReadEndMs: number | null;
  deserializeStartMs: number | null;
  deserializeEndMs: number | null;
  systemCommittedMs: number | null;
  mapStyleReadyMs: number | null;
  firstSystemPaintMs: number | null;
  interactiveMs: number | null;
  networkIdleMs: number | null;
  serviceWorkerReadyMs: number | null;
}

export interface PerfFirstSessionSample {
  journey: PerfFirstSessionJourney;
  surface: PerfSurface;
  cacheState: PerfCacheState;
  milestones: PerfFirstSessionMilestones;
  network: PerfNetworkByteReport;
}

/**
 * Records how a report's User Timing milestones were obtained. Network bytes
 * always come from CDP; this only makes a historic mark-compatibility shim
 * auditable instead of making it look like a shipping instrumentation run.
 */
export interface PerfReportProvenance {
  artifactRevision: string;
  milestoneMarkSource: 'shipping' | 'legacy-497a549-observer-v1';
}

export interface PerfReport {
  schemaVersion: 3;
  generatedAt: string;
  status: PerfReportStatus;
  unavailableReason?: string;
  failureReason?: string;
  protocol: PerfProtocol;
  calibration?: PerfCalibration;
  provenance?: PerfReportProvenance;
  bundles: PerfBundleEntry[];
  firstSessions: PerfFirstSessionSample[];
  samples: PerfSample[];
  scenarios: PerfScenarioSummary[];
  /** Optional so existing checked schema-v3 baselines remain readable. New
   * executable audits always list every phase they requested. */
  phases?: PerfAuditPhaseResult[];
  onboarding?: PerfOnboardingSample;
  /** Filled by the executable runner after report construction. */
  evaluation?: PerfBudgetEvaluation;
}

export interface CreatePerfReportOptions {
  generatedAt: string;
  protocol: PerfProtocol;
  scenarios: PerfScenario[];
  samples: PerfSample[];
  bundles?: PerfBundleEntry[];
  calibration?: PerfCalibration;
  provenance?: PerfReportProvenance;
  firstSessions?: PerfFirstSessionSample[];
  phases?: PerfAuditPhaseResult[];
  onboarding?: PerfOnboardingSample;
}

export interface CreatePartialPerfReportOptions extends CreatePerfReportOptions {
  reason: string;
}

export interface CreateUnavailablePerfReportOptions {
  generatedAt: string;
  protocol: PerfProtocol;
  scenarios: PerfScenario[];
  reason: string;
  bundles?: PerfBundleEntry[];
  calibration?: PerfCalibration;
  phases?: PerfAuditPhaseResult[];
}

type PerfBudgetViolationKind =
  | 'absolute'
  | 'regression'
  | 'bundle-regression'
  | 'baseline-missing'
  | 'baseline-incompatible'
  | 'first-session-unsettled'
  | 'first-session-byte-target'
  | 'first-session-byte-regression'
  | 'first-session-sample-missing';

export interface PerfBudgetViolation {
  kind: PerfBudgetViolationKind;
  scenarioId?: PerfScenarioId;
  metric?: PerfMetricName;
  actual?: number;
  normalizedActual?: number;
  baseline?: number;
  limit?: number;
  bundleEntry?: string;
  bundleEncoding?: 'raw' | 'gzip' | 'brotli';
  firstSessionJourney?: PerfFirstSessionJourney;
  firstSessionCacheState?: PerfCacheState;
  message: string;
}

type PerfBudgetStatus = 'pass' | 'fail' | 'unavailable';

export interface PerfBudgetEvaluation {
  status: PerfBudgetStatus;
  violations: PerfBudgetViolation[];
  notices: string[];
}

export interface PerfFirstSessionByteBudget {
  journey: PerfFirstSessionJourney;
  cacheState: PerfCacheState;
  /** Required fractional reduction from the frozen baseline, such as 0.3. */
  minimumReductionRatio?: number;
  /** Largest permitted fractional growth from the frozen baseline. */
  maximumRegressionRatio?: number;
}

export interface EvaluatePerfBudgetsOptions {
  report: PerfReport;
  baseline?: PerfReport;
  scenarios: PerfScenario[];
  maxRegressionRatio: number;
  firstSessionBudgets?: readonly PerfFirstSessionByteBudget[];
  requireBaseline?: boolean;
  /** A smoke proves that the production build and browser journey complete.
   * One sample is deliberately not treated as statistical timing evidence. */
  enforceNumericBudgets?: boolean;
}
