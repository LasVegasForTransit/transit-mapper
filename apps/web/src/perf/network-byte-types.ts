export type PerfNetworkTarget = 'page' | 'iframe' | 'dedicated-worker' | 'service-worker';
export type PerfByteCategory =
  | 'first-party-application'
  | 'external-map'
  | 'document-data'
  | 'service-worker'
  | 'telemetry'
  | 'other';
export type PerfCacheSource =
  'network' | 'disk' | 'memory-or-disk' | 'prefetch' | 'service-worker' | 'unknown';
export type PerfCompression = 'identity' | 'gzip' | 'br' | 'zstd' | 'other';
export type PerfRenderBlockingStatus = 'blocking' | 'non-blocking' | 'unknown';
type PerfAttributionSource = 'resource-timing' | 'cdp';
type PerfRequestByteAuthority = 'loading-finished';
export type PerfNetworkPhaseName =
  | 'document'
  | 'shell'
  | 'documentReady'
  | 'firstSystemPaint'
  | 'interactionReady'
  | 'networkIdle'
  | 'serviceWorkerReady'
  | 'automaticBoundary'
  | 'nMinusOneUpdate';

export interface PerfByteTotals {
  encodedBytes: number;
  decodedBytes: number;
  requestCount: number;
}

export interface PerfByteBreakdown {
  firstPartyApplication: PerfByteTotals;
  externalMap: PerfByteTotals;
  documentData: PerfByteTotals;
  serviceWorker: PerfByteTotals;
  telemetry: PerfByteTotals;
  other: PerfByteTotals;
  total: PerfByteTotals;
}

export interface PerfNetworkRequestReport {
  url: string;
  category: PerfByteCategory;
  target: PerfNetworkTarget;
  initiator: string;
  contentType: string;
  cacheSource: PerfCacheSource;
  protocol: string;
  compression: PerfCompression;
  renderBlockingStatus: PerfRenderBlockingStatus;
  attributionSource: PerfAttributionSource;
  byteAuthority: PerfRequestByteAuthority;
  encodedBytes: number;
  decodedBytes: number;
  startedAtMs: number;
  completedAtMs: number | null;
}

export interface PerfNetworkPhaseReport {
  atMs: number;
  bytes: PerfByteBreakdown;
}

export interface PerfNetworkByteReport {
  authority: 'cdp-network-encoded-data-length';
  automaticBoundaryMs: number;
  settled: boolean;
  unsettledNonMapRequestCount: number;
  requests: PerfNetworkRequestReport[];
  phases: Partial<Record<PerfNetworkPhaseName, PerfNetworkPhaseReport>>;
  total: PerfByteBreakdown;
}

export interface CreateNetworkByteLedgerOptions {
  applicationOrigin: string;
}

export interface PerfNetworkWindowOptions {
  navigationTimeOriginMs: number;
  automaticBoundaryMs: number;
}

export interface PerfNetworkIdleOptions extends PerfNetworkWindowOptions {
  notBeforeMs: number;
  quietWindowMs?: number;
}

export interface CreateNetworkByteReportOptions extends PerfNetworkWindowOptions {
  phases: Partial<Record<PerfNetworkPhaseName, number>>;
  resourceTimings?: readonly PerfResourceTimingAttribution[];
}

export interface PerfResourceTimingAttribution {
  url: string;
  startTimeMs: number;
  initiatorType: string;
  nextHopProtocol: string;
  renderBlockingStatus: PerfRenderBlockingStatus;
  /** Recorded only to prove these fields are not the byte authority. */
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
}

interface ByteChunk {
  timestamp: number;
  encodedBytes: number;
  decodedBytes: number;
}

export interface MutableNetworkRequest {
  key: string;
  requestId: string;
  sourceTargetId: string;
  frameId: string;
  url: string;
  target: PerfNetworkTarget;
  initiator: string;
  resourceType: string;
  renderBlockingStatus: PerfRenderBlockingStatus;
  hasUserGesture: boolean;
  /** CDP emits this parent-target lifecycle event before a Worker or OOPIF owns its load. */
  isTargetBootstrap: boolean;
  /** The first hop decides whether the complete redirect chain is in-contract. */
  contractStartedAt: number;
  startedAt: number;
  startedWallTime: number;
  responseAt: number | null;
  completedAt: number | null;
  contentType: string;
  cacheSource: PerfCacheSource;
  protocol: string;
  compression: PerfCompression;
  servedFromCache: boolean;
  encodedBytes: number | null;
  byteAuthority: PerfRequestByteAuthority | null;
  /** Kept only until a fail-closed harness error can name the CDP cause. */
  failureReason: string | null;
  chunks: ByteChunk[];
}

export interface RequestWillBeSent {
  requestId?: unknown;
  frameId?: unknown;
  timestamp?: unknown;
  wallTime?: unknown;
  type?: unknown;
  request?: { url?: unknown };
  initiator?: { type?: unknown };
  renderBlockingBehavior?: unknown;
  hasUserGesture?: unknown;
  redirectResponse?: CdpResponse;
}

export interface CdpResponse {
  url?: unknown;
  mimeType?: unknown;
  protocol?: unknown;
  headers?: Record<string, unknown>;
  fromDiskCache?: unknown;
  fromServiceWorker?: unknown;
  fromPrefetchCache?: unknown;
  encodedDataLength?: unknown;
}

export interface ResponseReceived {
  requestId?: unknown;
  timestamp?: unknown;
  type?: unknown;
  response?: CdpResponse;
}

export interface DataReceived {
  requestId?: unknown;
  timestamp?: unknown;
  dataLength?: unknown;
  encodedDataLength?: unknown;
}

export interface LoadingFinished {
  requestId?: unknown;
  timestamp?: unknown;
  encodedDataLength?: unknown;
}

export interface LoadingFailed {
  requestId?: unknown;
  timestamp?: unknown;
  canceled?: unknown;
  errorText?: unknown;
}

export interface NetworkByteLedger {
  registerTarget(targetId: string, target: PerfNetworkTarget): void;
  record(targetId: string, method: string, params: Record<string, unknown>): void;
  excludeTargetBootstrapRequest(targetId: string): void;
  excludeIframeNavigationRequest(frameId: string): void;
  pendingContractRequestCount(options: PerfNetworkWindowOptions): number;
  pendingContractRequestDescriptions(options: PerfNetworkWindowOptions): readonly string[];
  networkIdleAt(options: PerfNetworkIdleOptions): number | null;
  createReport(options: CreateNetworkByteReportOptions): PerfNetworkByteReport;
}
