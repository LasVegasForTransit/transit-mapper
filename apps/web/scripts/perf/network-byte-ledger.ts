import type {
  CreateNetworkByteLedgerOptions,
  CreateNetworkByteReportOptions,
  CdpResponse,
  DataReceived,
  LoadingFailed,
  LoadingFinished,
  MutableNetworkRequest,
  NetworkByteLedger,
  PerfByteBreakdown,
  PerfByteCategory,
  PerfNetworkIdleOptions,
  PerfNetworkPhaseName,
  PerfNetworkPhaseReport,
  PerfNetworkByteReport,
  PerfNetworkRequestReport,
  PerfNetworkTarget,
  PerfNetworkWindowOptions,
  RequestWillBeSent,
  ResponseReceived,
} from '../../src/perf/network-byte-types';
import {
  cacheSource,
  categoryFor,
  compression,
  renderBlockingStatus,
} from './network-request-classification';
import {
  createResourceTimingMatcher,
  type ResourceTimingMatcher,
} from './resource-timing-attribution';
import { addTotals, completedBytes, emptyBreakdown, requestBytesAt } from './network-byte-totals';
import { findNetworkIdleAt } from './network-idle';

export type { NetworkByteLedger, PerfNetworkByteReport } from '../../src/perf/network-byte-types';

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === '') return undefined;
  return value;
}

interface RequestStart {
  sourceTargetId: string;
  target: PerfNetworkTarget;
  requestId: string;
  frameId: string;
  timestamp: number;
  wallTime: number;
  url: string;
}

function parseRequestStart(
  sourceTargetId: string,
  target: PerfNetworkTarget | undefined,
  raw: RequestWillBeSent,
): RequestStart | null {
  const requestId = stringValue(raw.requestId);
  const timestamp = finiteNumber(raw.timestamp);
  const wallTime = finiteNumber(raw.wallTime);
  const url = stringValue(raw.request?.url);
  const frameId = stringValue(raw.frameId);
  if (!target || !requestId || timestamp === null || wallTime === null || !url) return null;
  return { sourceTargetId, target, requestId, frameId, timestamp, wallTime, url };
}

function applyResponseMetadata(
  request: MutableNetworkRequest,
  response: CdpResponse | undefined,
  timestamp: number,
  resourceType?: unknown,
): void {
  request.responseAt = timestamp;
  request.url = stringValue(response?.url) || request.url;
  request.resourceType = stringValue(resourceType) || request.resourceType;
  request.contentType = stringValue(response?.mimeType);
  request.protocol = stringValue(response?.protocol);
  request.compression = compression(response?.headers);
  request.cacheSource = cacheSource(response, request.servedFromCache);
}

class CdpNetworkByteLedger implements NetworkByteLedger {
  private readonly targets = new Map<string, PerfNetworkTarget>();
  private readonly requests = new Map<string, MutableNetworkRequest>();
  private readonly activeRequestKeys = new Map<string, string>();
  private readonly requestSequences = new Map<string, number>();
  private readonly targetBootstrapRequestIds = new Set<string>();
  private readonly iframeBootstrapFrameIds = new Set<string>();
  private epochOffsetSeconds: number | null = null;

  constructor(private readonly options: CreateNetworkByteLedgerOptions) {}

  private requestKey(targetId: string, requestId: string): string {
    return `${targetId}:${requestId}`;
  }

  private currentRequest(targetId: string, requestId: unknown): MutableNetworkRequest | undefined {
    const activeKey = this.activeRequestKeys.get(this.requestKey(targetId, stringValue(requestId)));
    return activeKey ? this.requests.get(activeKey) : undefined;
  }

  private nextRequestKey(baseKey: string): string {
    const sequence = (this.requestSequences.get(baseKey) ?? -1) + 1;
    this.requestSequences.set(baseKey, sequence);
    return `${baseKey}:${sequence}`;
  }

  private completeRedirect(
    request: MutableNetworkRequest,
    response: CdpResponse,
    timestamp: number,
  ): void {
    applyResponseMetadata(request, response, timestamp);
    request.completedAt = timestamp;
  }

  private recordRequest(targetId: string, raw: RequestWillBeSent): void {
    const start = parseRequestStart(targetId, this.targets.get(targetId), raw);
    if (!start) return;
    this.epochOffsetSeconds ??= start.wallTime - start.timestamp;
    const baseKey = this.requestKey(targetId, start.requestId);
    const active = this.currentRequest(targetId, start.requestId);
    const contractStartedAt = active?.contractStartedAt ?? start.timestamp;
    const hasUserGesture = active?.hasUserGesture ?? raw.hasUserGesture === true;
    if (active && raw.redirectResponse) {
      this.completeRedirect(active, raw.redirectResponse, start.timestamp);
    } else if (active) {
      return;
    }
    const key = this.nextRequestKey(baseKey);
    this.requests.set(key, {
      key,
      requestId: start.requestId,
      sourceTargetId: start.sourceTargetId,
      frameId: start.frameId,
      url: start.url,
      target: start.target,
      initiator: stringValue(raw.initiator?.type) || 'unknown',
      resourceType: stringValue(raw.type) || 'Other',
      renderBlockingStatus: renderBlockingStatus(raw.renderBlockingBehavior),
      hasUserGesture,
      isTargetBootstrap:
        this.targetBootstrapRequestIds.has(start.requestId) ||
        (this.iframeBootstrapFrameIds.has(start.frameId) && start.sourceTargetId !== start.frameId),
      contractStartedAt,
      startedAt: start.timestamp,
      startedWallTime: start.wallTime,
      responseAt: null,
      completedAt: null,
      contentType: '',
      cacheSource: 'unknown',
      protocol: '',
      compression: 'identity',
      servedFromCache: false,
      encodedBytes: null,
      byteAuthority: null,
      failureReason: null,
      chunks: [],
    });
    this.activeRequestKeys.set(baseKey, key);
  }

  private recordResponse(targetId: string, raw: ResponseReceived): void {
    const request = this.currentRequest(targetId, raw.requestId);
    const timestamp = finiteNumber(raw.timestamp);
    if (!request || timestamp === null) return;
    applyResponseMetadata(request, raw.response, timestamp, raw.type);
  }

  private recordData(targetId: string, raw: DataReceived): void {
    const request = this.currentRequest(targetId, raw.requestId);
    const timestamp = finiteNumber(raw.timestamp);
    if (!request || timestamp === null) return;
    request.chunks.push({
      timestamp,
      encodedBytes: Math.max(0, finiteNumber(raw.encodedDataLength) ?? 0),
      decodedBytes: Math.max(0, finiteNumber(raw.dataLength) ?? 0),
    });
  }

  private recordFinished(targetId: string, raw: LoadingFinished): void {
    const request = this.currentRequest(targetId, raw.requestId);
    const timestamp = finiteNumber(raw.timestamp);
    const encodedBytes = finiteNumber(raw.encodedDataLength);
    if (!request || timestamp === null || encodedBytes === null) return;
    request.completedAt = timestamp;
    request.encodedBytes = Math.max(0, encodedBytes);
    request.byteAuthority = 'loading-finished';
  }

  private recordFailed(targetId: string, raw: LoadingFailed): void {
    const request = this.currentRequest(targetId, raw.requestId);
    const timestamp = finiteNumber(raw.timestamp);
    if (!request || timestamp === null) return;
    request.completedAt = timestamp;
    const error = stringValue(raw.errorText) || 'CDP did not provide a failure reason';
    request.failureReason = raw.canceled === true ? `${error} (canceled)` : error;
  }

  private cdpTimestampFor(timeOriginMs: number, relativeMs: number): number {
    if (this.epochOffsetSeconds === null) return relativeMs / 1_000;
    return (timeOriginMs + relativeMs) / 1_000 - this.epochOffsetSeconds;
  }

  private relativeMs(timestamp: number, timeOriginMs: number): number {
    return (timestamp + (this.epochOffsetSeconds ?? 0)) * 1_000 - timeOriginMs;
  }

  private reportRequest(
    request: MutableNetworkRequest,
    navigationTimeOriginMs: number,
    matcher: ResourceTimingMatcher,
  ): PerfNetworkRequestReport {
    const bytes = completedBytes(request);
    const byteAuthority = request.byteAuthority;
    if (!byteAuthority) {
      const failure = request.failureReason ? ` CDP failure: ${request.failureReason}.` : '';
      throw new Error(`Automatic request ${request.url} has no CDP byte authority.${failure}`);
    }
    const startedAtMs = request.startedWallTime * 1_000 - navigationTimeOriginMs;
    const attribution = matcher.match(request.url, startedAtMs, request.target);
    return {
      url: request.url,
      category: categoryFor(request.url, request.target, this.options.applicationOrigin),
      target: request.target,
      initiator: nonEmpty(attribution?.initiatorType) ?? request.initiator,
      contentType: request.contentType,
      cacheSource: request.cacheSource,
      protocol: nonEmpty(attribution?.nextHopProtocol) ?? request.protocol,
      compression: request.compression,
      renderBlockingStatus:
        attribution?.renderBlockingStatus === undefined ||
        attribution.renderBlockingStatus === 'unknown'
          ? request.renderBlockingStatus
          : attribution.renderBlockingStatus,
      attributionSource: attribution ? 'resource-timing' : 'cdp',
      byteAuthority,
      encodedBytes: bytes.encodedBytes,
      decodedBytes: bytes.decodedBytes,
      startedAtMs,
      completedAtMs:
        request.completedAt === null
          ? null
          : this.relativeMs(request.completedAt, navigationTimeOriginMs),
    };
  }

  private includedRequests(boundary: number): MutableNetworkRequest[] {
    return [...this.requests.values()].filter(
      (request) =>
        request.contractStartedAt <= boundary &&
        !request.hasUserGesture &&
        !request.isTargetBootstrap,
    );
  }

  private category(request: MutableNetworkRequest): PerfByteCategory {
    return categoryFor(request.url, request.target, this.options.applicationOrigin);
  }

  private totalFor(requests: MutableNetworkRequest[]): PerfByteBreakdown {
    const total = emptyBreakdown();
    for (const request of requests)
      addTotals(total, this.category(request), completedBytes(request));
    return total;
  }

  private phaseFor(requests: MutableNetworkRequest[], at: number): PerfByteBreakdown {
    const breakdown = emptyBreakdown();
    for (const request of requests) {
      if (request.startedAt <= at) {
        addTotals(breakdown, this.category(request), requestBytesAt(request, at));
      }
    }
    return breakdown;
  }

  private phasesFor(
    requests: MutableNetworkRequest[],
    options: CreateNetworkByteReportOptions,
  ): Partial<Record<PerfNetworkPhaseName, PerfNetworkPhaseReport>> {
    const phases: Partial<Record<PerfNetworkPhaseName, PerfNetworkPhaseReport>> = {};
    for (const [phase, relativeMs] of Object.entries(options.phases) as Array<
      [PerfNetworkPhaseName, number]
    >) {
      phases[phase] = {
        atMs: relativeMs,
        bytes: this.phaseFor(
          requests,
          this.cdpTimestampFor(options.navigationTimeOriginMs, relativeMs),
        ),
      };
    }
    return phases;
  }

  private unsettledCount(boundary: number): number {
    return [...this.requests.values()].filter((request) => {
      if (
        request.hasUserGesture ||
        request.isTargetBootstrap ||
        this.category(request) === 'external-map'
      ) {
        return false;
      }
      return (
        (request.contractStartedAt <= boundary &&
          (request.completedAt === null || request.completedAt > boundary)) ||
        request.contractStartedAt > boundary
      );
    }).length;
  }

  registerTarget(targetId: string, target: PerfNetworkTarget): void {
    this.targets.set(targetId, target);
  }

  excludeTargetBootstrapRequest(targetId: string): void {
    this.targetBootstrapRequestIds.add(targetId);
    for (const request of this.requests.values()) {
      if (request.requestId === targetId && request.sourceTargetId !== targetId) {
        request.isTargetBootstrap = true;
      }
    }
  }

  excludeIframeNavigationRequest(frameId: string): void {
    this.iframeBootstrapFrameIds.add(frameId);
    for (const request of this.requests.values()) {
      if (request.frameId === frameId && request.sourceTargetId !== frameId) {
        request.isTargetBootstrap = true;
      }
    }
  }

  record(targetId: string, method: string, params: Record<string, unknown>): void {
    if (method === 'Network.requestWillBeSent') this.recordRequest(targetId, params);
    else if (method === 'Network.responseReceived') this.recordResponse(targetId, params);
    else if (method === 'Network.dataReceived') this.recordData(targetId, params);
    else if (method === 'Network.loadingFinished') this.recordFinished(targetId, params);
    else if (method === 'Network.loadingFailed') this.recordFailed(targetId, params);
    else if (method === 'Network.requestServedFromCache') {
      const request = this.currentRequest(targetId, params.requestId);
      if (request) request.servedFromCache = true;
    }
  }

  pendingContractRequestCount(options: PerfNetworkWindowOptions): number {
    const boundary = this.cdpTimestampFor(
      options.navigationTimeOriginMs,
      options.automaticBoundaryMs,
    );
    return this.pendingContractRequests(boundary).length;
  }

  pendingContractRequestDescriptions(options: PerfNetworkWindowOptions): readonly string[] {
    const boundary = this.cdpTimestampFor(
      options.navigationTimeOriginMs,
      options.automaticBoundaryMs,
    );
    return this.pendingContractRequests(boundary).map(
      (request) => `${request.target}:${request.url}`,
    );
  }

  private pendingContractRequests(boundary: number): MutableNetworkRequest[] {
    return [...this.requests.values()].filter(
      (request) =>
        request.contractStartedAt <= boundary &&
        !request.hasUserGesture &&
        !request.isTargetBootstrap &&
        request.completedAt === null,
    );
  }

  networkIdleAt(options: PerfNetworkIdleOptions): number | null {
    const boundary = this.cdpTimestampFor(
      options.navigationTimeOriginMs,
      options.automaticBoundaryMs,
    );
    return findNetworkIdleAt({
      intervals: [...this.requests.values()]
        .filter(
          (request) =>
            !request.hasUserGesture &&
            !request.isTargetBootstrap &&
            request.contractStartedAt <= boundary,
        )
        .map((request) => ({
          startedAtMs: this.relativeMs(request.startedAt, options.navigationTimeOriginMs),
          completedAtMs:
            request.completedAt === null
              ? null
              : this.relativeMs(request.completedAt, options.navigationTimeOriginMs),
        })),
      notBeforeMs: options.notBeforeMs,
      boundaryMs: options.automaticBoundaryMs,
      quietWindowMs: options.quietWindowMs ?? 500,
    });
  }

  createReport(options: CreateNetworkByteReportOptions): PerfNetworkByteReport {
    const boundary = this.cdpTimestampFor(
      options.navigationTimeOriginMs,
      options.automaticBoundaryMs,
    );
    const included = this.includedRequests(boundary);
    const unsettledNonMapRequestCount = this.unsettledCount(boundary);
    const matcher = createResourceTimingMatcher(options.resourceTimings ?? []);
    return {
      authority: 'cdp-network-encoded-data-length',
      automaticBoundaryMs: options.automaticBoundaryMs,
      settled: unsettledNonMapRequestCount === 0,
      unsettledNonMapRequestCount,
      requests: included
        .sort((left, right) => left.startedAt - right.startedAt)
        .map((request) => this.reportRequest(request, options.navigationTimeOriginMs, matcher)),
      phases: this.phasesFor(included, options),
      total: this.totalFor(included),
    };
  }
}

export function createNetworkByteLedger(
  options: CreateNetworkByteLedgerOptions,
): NetworkByteLedger {
  return new CdpNetworkByteLedger(options);
}
