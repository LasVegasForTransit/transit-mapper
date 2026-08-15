import { describe, expect, it } from 'vitest';
import { createNetworkByteLedger } from '../../scripts/perf/network-byte-ledger';

const NAVIGATION_TIME_ORIGIN_MS = 1_000_000;
const CDP_EPOCH_OFFSET_SECONDS = 990;

function request(
  url: string,
  timestamp: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    requestId: url,
    timestamp,
    wallTime: timestamp + CDP_EPOCH_OFFSET_SECONDS,
    type: 'Script',
    request: { url },
    initiator: { type: 'parser' },
    renderBlockingBehavior: 'Blocking',
    hasUserGesture: false,
    ...overrides,
  };
}

function response(
  requestId: string,
  timestamp: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    requestId,
    timestamp,
    type: 'Script',
    response: {
      url: requestId,
      mimeType: 'text/javascript',
      protocol: 'h2',
      headers: { 'content-encoding': 'br' },
      fromDiskCache: false,
      fromServiceWorker: false,
      fromPrefetchCache: false,
      ...overrides,
    },
  };
}

describe('the CDP network byte ledger', () => {
  it('uses loadingFinished bytes as authority and reports phase-level attribution', () => {
    const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
    ledger.registerTarget('page-1', 'page');
    ledger.record(
      'page-1',
      'Network.requestWillBeSent',
      request('https://app.test/assets/main.js', 10),
    );
    ledger.record(
      'page-1',
      'Network.responseReceived',
      response('https://app.test/assets/main.js', 10.05),
    );
    ledger.record('page-1', 'Network.dataReceived', {
      requestId: 'https://app.test/assets/main.js',
      timestamp: 10.08,
      dataLength: 400,
      encodedDataLength: 100,
    });
    ledger.record('page-1', 'Network.loadingFinished', {
      requestId: 'https://app.test/assets/main.js',
      timestamp: 10.1,
      encodedDataLength: 120,
    });

    const report = ledger.createReport({
      navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
      automaticBoundaryMs: 60_000,
      phases: {
        document: 40,
        shell: 75,
        documentReady: 110,
      },
    });

    expect(report.authority).toBe('cdp-network-encoded-data-length');
    expect(report.settled).toBe(true);
    expect(report.requests).toEqual([
      expect.objectContaining({
        category: 'first-party-application',
        target: 'page',
        initiator: 'parser',
        contentType: 'text/javascript',
        cacheSource: 'network',
        protocol: 'h2',
        compression: 'br',
        renderBlockingStatus: 'blocking',
        encodedBytes: 120,
        decodedBytes: 400,
        startedAtMs: 0,
        completedAtMs: 100,
      }),
    ]);
    expect(report.phases.document?.atMs).toBe(40);
    expect(report.phases.document?.bytes.total).toEqual({
      encodedBytes: 0,
      decodedBytes: 0,
      requestCount: 1,
    });
    expect(report.phases.shell?.atMs).toBe(75);
    expect(report.phases.shell?.bytes.total).toEqual({
      encodedBytes: 20,
      decodedBytes: 0,
      requestCount: 1,
    });
    expect(report.phases.documentReady?.atMs).toBe(110);
    expect(report.phases.documentReady?.bytes.total).toEqual({
      encodedBytes: 120,
      decodedBytes: 400,
      requestCount: 1,
    });
    expect(report.total.firstPartyApplication).toEqual({
      encodedBytes: 120,
      decodedBytes: 400,
      requestCount: 1,
    });
  });

  it('uses Resource Timing for attribution without using its byte totals', () => {
    const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
    const url = 'https://app.test/assets/attributed.js';
    ledger.registerTarget('page', 'page');
    ledger.record(
      'page',
      'Network.requestWillBeSent',
      request(url, 10, {
        initiator: { type: 'script' },
        renderBlockingBehavior: 'NonBlocking',
      }),
    );
    ledger.record('page', 'Network.responseReceived', response(url, 10.01));
    ledger.record('page', 'Network.dataReceived', {
      requestId: url,
      timestamp: 10.02,
      dataLength: 400,
      encodedDataLength: 100,
    });
    ledger.record('page', 'Network.loadingFinished', {
      requestId: url,
      timestamp: 10.03,
      encodedDataLength: 120,
    });

    const report = ledger.createReport({
      navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
      automaticBoundaryMs: 60_000,
      phases: {},
      resourceTimings: [
        {
          url,
          startTimeMs: 0,
          initiatorType: 'parser',
          nextHopProtocol: 'h3',
          renderBlockingStatus: 'blocking',
          transferSize: 9_999,
          encodedBodySize: 9_999,
          decodedBodySize: 9_999,
        },
      ],
    });

    expect(report.requests[0]).toEqual(
      expect.objectContaining({
        attributionSource: 'resource-timing',
        initiator: 'parser',
        protocol: 'h3',
        renderBlockingStatus: 'blocking',
        encodedBytes: 120,
        decodedBytes: 400,
      }),
    );
    expect(report.total.total.encodedBytes).toBe(120);
  });

  it('fails closed for an intermediate redirect without loadingFinished authority', () => {
    const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
    const initialUrl = 'https://app.test/redirect';
    const finalUrl = 'https://app.test/assets/final.js';
    ledger.registerTarget('page', 'page');
    ledger.record(
      'page',
      'Network.requestWillBeSent',
      request(initialUrl, 10, { requestId: 'redirect-chain' }),
    );
    ledger.record(
      'page',
      'Network.responseReceived',
      response('redirect-chain', 10.01, { url: initialUrl, mimeType: 'text/html' }),
    );
    ledger.record(
      'page',
      'Network.requestWillBeSent',
      request(finalUrl, 10.02, {
        requestId: 'redirect-chain',
        redirectResponse: {
          url: initialUrl,
          mimeType: 'text/html',
          protocol: 'h2',
          headers: {},
          encodedDataLength: 300,
        },
      }),
    );
    ledger.record(
      'page',
      'Network.responseReceived',
      response('redirect-chain', 10.03, { url: finalUrl }),
    );
    ledger.record('page', 'Network.loadingFinished', {
      requestId: 'redirect-chain',
      timestamp: 10.04,
      encodedDataLength: 500,
    });

    expect(() =>
      ledger.createReport({
        navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
        automaticBoundaryMs: 60_000,
        phases: {},
      }),
    ).toThrow(initialUrl);
  });

  it('separates map, document, service-worker, and telemetry targets', () => {
    const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
    const cases = [
      {
        targetId: 'page',
        target: 'page' as const,
        url: 'https://tiles.openfreemap.org/0/0/0.pbf',
        category: 'external-map',
      },
      {
        targetId: 'iframe',
        target: 'iframe' as const,
        url: 'https://app.test/api/systems/perfshare',
        category: 'document-data',
      },
      {
        targetId: 'worker',
        target: 'dedicated-worker' as const,
        url: 'https://app.test/assets/storage-worker.js',
        category: 'first-party-application',
      },
      {
        targetId: 'service-worker',
        target: 'service-worker' as const,
        url: 'https://app.test/assets/lazy.js',
        category: 'service-worker',
      },
      {
        targetId: 'beacon',
        target: 'page' as const,
        url: 'https://app.test/api/performance-samples',
        category: 'telemetry',
      },
    ];

    for (const [index, candidate] of cases.entries()) {
      ledger.registerTarget(candidate.targetId, candidate.target);
      ledger.record(
        candidate.targetId,
        'Network.requestWillBeSent',
        request(candidate.url, 10 + index),
      );
      ledger.record(
        candidate.targetId,
        'Network.responseReceived',
        response(candidate.url, 10.01 + index),
      );
      ledger.record(candidate.targetId, 'Network.loadingFinished', {
        requestId: candidate.url,
        timestamp: 10.02 + index,
        encodedDataLength: 10 + index,
      });
    }

    const report = ledger.createReport({
      navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
      automaticBoundaryMs: 60_000,
      phases: { automaticBoundary: 60_000 },
    });

    expect(report.requests.map(({ target, category }) => ({ target, category }))).toEqual(
      cases.map(({ target, category }) => ({ target, category })),
    );
    expect(report.total.externalMap.requestCount).toBe(1);
    expect(report.total.documentData.requestCount).toBe(1);
    expect(report.total.serviceWorker.requestCount).toBe(1);
    expect(report.total.telemetry.requestCount).toBe(1);
    expect(report.total.total.requestCount).toBe(5);
  });

  it('identifies cache and compression sources without changing wire-byte totals', () => {
    const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
    ledger.registerTarget('page', 'page');
    const url = 'https://app.test/assets/cached.css';
    ledger.record('page', 'Network.requestWillBeSent', request(url, 10));
    ledger.record(
      'page',
      'Network.responseReceived',
      response(url, 10.01, {
        mimeType: 'text/css',
        protocol: 'h3',
        headers: { 'Content-Encoding': 'zstd' },
        fromServiceWorker: true,
      }),
    );
    ledger.record('page', 'Network.loadingFinished', {
      requestId: url,
      timestamp: 10.02,
      encodedDataLength: 0,
    });

    const report = ledger.createReport({
      navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
      automaticBoundaryMs: 60_000,
      phases: {},
    });

    expect(report.requests[0]).toEqual(
      expect.objectContaining({
        cacheSource: 'service-worker',
        compression: 'zstd',
        protocol: 'h3',
        contentType: 'text/css',
        encodedBytes: 0,
      }),
    );
  });

  it('counts pre-boundary requests through completion and fails unsettled non-map work', () => {
    const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
    ledger.registerTarget('page', 'page');
    const before = 'https://app.test/assets/before.js';
    const after = 'https://app.test/assets/after.js';
    const lateMap = 'https://tiles.openfreemap.org/late.pbf';
    const lateThirdParty = 'https://unexpected.example/automatic.js';

    ledger.record('page', 'Network.requestWillBeSent', request(before, 69.9));
    expect(
      ledger.pendingContractRequestCount({
        navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
        automaticBoundaryMs: 60_000,
      }),
    ).toBe(1);
    ledger.record('page', 'Network.responseReceived', response(before, 70));
    ledger.record('page', 'Network.loadingFinished', {
      requestId: before,
      timestamp: 70.2,
      encodedDataLength: 50,
    });
    expect(
      ledger.pendingContractRequestCount({
        navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
        automaticBoundaryMs: 60_000,
      }),
    ).toBe(0);
    ledger.record('page', 'Network.requestWillBeSent', request(after, 70.1));
    ledger.record('page', 'Network.requestWillBeSent', request(lateMap, 70.2));
    ledger.record('page', 'Network.requestWillBeSent', request(lateThirdParty, 70.3));

    const report = ledger.createReport({
      navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
      automaticBoundaryMs: 60_000,
      phases: { automaticBoundary: 60_000 },
    });

    expect(report.total.total.encodedBytes).toBe(50);
    expect(report.requests.map((entry) => entry.url)).toEqual([before]);
    expect(report.settled).toBe(false);
    expect(report.unsettledNonMapRequestCount).toBe(3);
  });
});
