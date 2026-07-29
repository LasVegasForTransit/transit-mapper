import type { TransitSystem } from '@transitmapper/core/model/system';

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
  stations: number;
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

export interface PerfNetworkProfile {
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
  /** The named storage serialization Worker's measured request/response lane. */
  workerSerializationMs: number;
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
    productionWorkerSerializationMs: PerfMetricSummary;
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

export type PerfReportStatus = 'ok' | 'unavailable';

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

export interface PerfReport {
  schemaVersion: 2;
  generatedAt: string;
  status: PerfReportStatus;
  unavailableReason?: string;
  protocol: PerfProtocol;
  calibration?: PerfCalibration;
  bundles: PerfBundleEntry[];
  samples: PerfSample[];
  scenarios: PerfScenarioSummary[];
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
}

export interface CreateUnavailablePerfReportOptions {
  generatedAt: string;
  protocol: PerfProtocol;
  scenarios: PerfScenario[];
  reason: string;
  bundles?: PerfBundleEntry[];
  calibration?: PerfCalibration;
}

export interface GeneratePerfFixtureOptions {
  scenario: PerfScenario;
}

export interface PerfFixture {
  scenario: PerfScenario;
  system: TransitSystem;
}

export type PerfBudgetViolationKind =
  'absolute' | 'regression' | 'bundle-regression' | 'baseline-missing';

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
  message: string;
}

export type PerfBudgetStatus = 'pass' | 'fail' | 'unavailable';

export interface PerfBudgetEvaluation {
  status: PerfBudgetStatus;
  violations: PerfBudgetViolation[];
  notices: string[];
}

export interface EvaluatePerfBudgetsOptions {
  report: PerfReport;
  baseline?: PerfReport;
  scenarios: PerfScenario[];
  maxRegressionRatio: number;
  requireBaseline?: boolean;
  /** A smoke proves that the production build and browser journey complete.
   * One sample is deliberately not treated as statistical timing evidence. */
  enforceNumericBudgets?: boolean;
}
