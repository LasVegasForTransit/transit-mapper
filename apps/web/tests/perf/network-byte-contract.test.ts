import { describe, expect, it } from 'vitest';
import { createNetworkByteLedger } from '../../scripts/perf/network-byte-ledger';

const NAVIGATION_TIME_ORIGIN_MS = 1_000_000;
const CDP_EPOCH_OFFSET_SECONDS = 990;

function request(url: string, timestamp: number): Record<string, unknown> {
  return {
    requestId: url,
    timestamp,
    wallTime: timestamp + CDP_EPOCH_OFFSET_SECONDS,
    type: 'Script',
    request: { url },
    initiator: { type: 'parser' },
    hasUserGesture: false,
  };
}

function response(url: string, timestamp: number): Record<string, unknown> {
  return {
    requestId: url,
    timestamp,
    type: 'Script',
    response: {
      url,
      mimeType: 'text/javascript',
      protocol: 'h2',
      headers: {},
    },
  };
}

describe('the exact CDP byte contract', () => {
  it('fails closed when an in-contract redirect lacks loadingFinished authority', () => {
    const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
    const initialUrl = 'https://app.test/redirect';
    const finalUrl = 'https://app.test/assets/final.js';
    const chainId = 'boundary-redirect';
    ledger.registerTarget('page', 'page');
    ledger.record('page', 'Network.requestWillBeSent', {
      ...request(initialUrl, 69.9),
      requestId: chainId,
    });
    ledger.record('page', 'Network.requestWillBeSent', {
      ...request(finalUrl, 70.1),
      requestId: chainId,
      redirectResponse: {
        url: initialUrl,
        mimeType: 'text/html',
        protocol: 'h2',
        headers: {},
        encodedDataLength: 300,
      },
    });

    expect(
      ledger.pendingContractRequestCount({
        navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
        automaticBoundaryMs: 60_000,
      }),
    ).toBe(1);

    ledger.record('page', 'Network.loadingFinished', {
      requestId: chainId,
      timestamp: 70.2,
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

  it('fails settlement when automatic non-map work completes after the boundary', () => {
    const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
    const url = 'https://app.test/assets/slow.js';
    ledger.registerTarget('page', 'page');
    ledger.record('page', 'Network.requestWillBeSent', request(url, 69.9));
    ledger.record('page', 'Network.responseReceived', response(url, 69.95));
    ledger.record('page', 'Network.loadingFinished', {
      requestId: url,
      timestamp: 70.2,
      encodedDataLength: 50,
    });

    const report = ledger.createReport({
      navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
      automaticBoundaryMs: 60_000,
      phases: {},
    });

    expect(report.total.total.encodedBytes).toBe(50);
    expect(report.settled).toBe(false);
    expect(report.unsettledNonMapRequestCount).toBe(1);
  });

  it('derives network idle from a quiet window across every CDP target', () => {
    const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
    ledger.registerTarget('page', 'page');
    ledger.registerTarget('worker', 'dedicated-worker');
    const pageUrl = 'https://app.test/index.html';
    const workerUrl = 'https://app.test/assets/worker.js';
    ledger.record('page', 'Network.requestWillBeSent', request(pageUrl, 10));
    ledger.record('page', 'Network.loadingFinished', {
      requestId: pageUrl,
      timestamp: 10.1,
      encodedDataLength: 50,
    });
    ledger.record('worker', 'Network.requestWillBeSent', request(workerUrl, 10.2));
    ledger.record('worker', 'Network.loadingFinished', {
      requestId: workerUrl,
      timestamp: 10.3,
      encodedDataLength: 50,
    });

    expect(
      ledger.networkIdleAt({
        navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
        automaticBoundaryMs: 60_000,
        notBeforeMs: 0,
        quietWindowMs: 500,
      }),
    ).toBeCloseTo(800);
  });

  it('rejects an included response without loadingFinished byte authority', () => {
    const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
    const url = 'https://app.test/assets/cancelled.js';
    ledger.registerTarget('page', 'page');
    ledger.record('page', 'Network.requestWillBeSent', request(url, 10));
    ledger.record('page', 'Network.responseReceived', response(url, 10.01));
    ledger.record('page', 'Network.dataReceived', {
      requestId: url,
      timestamp: 10.02,
      dataLength: 100,
      encodedDataLength: 50,
    });
    ledger.record('page', 'Network.loadingFailed', {
      requestId: url,
      timestamp: 10.03,
    });

    expect(() =>
      ledger.createReport({
        navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
        automaticBoundaryMs: 60_000,
        phases: {},
      }),
    ).toThrow('has no authoritative encodedDataLength');
  });

  it('keeps an authoritative zero instead of substituting chunk bytes', () => {
    const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
    const url = 'https://app.test/assets/empty.js';
    ledger.registerTarget('page', 'page');
    ledger.record('page', 'Network.requestWillBeSent', request(url, 10));
    ledger.record('page', 'Network.responseReceived', response(url, 10.01));
    ledger.record('page', 'Network.dataReceived', {
      requestId: url,
      timestamp: 10.02,
      dataLength: 100,
      encodedDataLength: 50,
    });
    ledger.record('page', 'Network.loadingFinished', {
      requestId: url,
      timestamp: 10.03,
      encodedDataLength: 0,
    });

    const report = ledger.createReport({
      navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
      automaticBoundaryMs: 60_000,
      phases: { document: 50 },
    });

    expect(report.total.total.encodedBytes).toBe(0);
    expect(report.phases.document?.bytes.total.encodedBytes).toBe(0);
  });

  it('excludes dedicated Worker and OOPIF target bootstrap lifecycle events', () => {
    const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
    const workerTargetId = 'worker-target';
    const iframeTargetId = 'iframe-target';
    ledger.registerTarget('page', 'page');
    ledger.record('page', 'Network.requestWillBeSent', {
      ...request('https://app.test/assets/storage-worker.js', 10),
      requestId: workerTargetId,
    });
    ledger.record('page', 'Network.requestWillBeSent', {
      ...request('https://app.test/e/perfembed', 10.1),
      frameId: iframeTargetId,
      requestId: 'iframe-navigation',
    });

    ledger.excludeTargetBootstrapRequest(workerTargetId);
    ledger.excludeIframeNavigationRequest(iframeTargetId);

    const window = {
      navigationTimeOriginMs: NAVIGATION_TIME_ORIGIN_MS,
      automaticBoundaryMs: 60_000,
    };
    expect(ledger.pendingContractRequestCount(window)).toBe(0);
    expect(ledger.createReport({ ...window, phases: {} }).requests).toEqual([]);
  });
});
