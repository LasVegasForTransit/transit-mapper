import type {
  MutableNetworkRequest,
  PerfByteBreakdown,
  PerfByteCategory,
  PerfByteTotals,
} from '../../src/perf/network-byte-types';

const CATEGORY_KEYS: Record<PerfByteCategory, keyof PerfByteBreakdown> = {
  'first-party-application': 'firstPartyApplication',
  'external-map': 'externalMap',
  'document-data': 'documentData',
  'service-worker': 'serviceWorker',
  telemetry: 'telemetry',
  other: 'other',
};

function emptyTotals(): PerfByteTotals {
  return { encodedBytes: 0, decodedBytes: 0, requestCount: 0 };
}

export function emptyBreakdown(): PerfByteBreakdown {
  return {
    firstPartyApplication: emptyTotals(),
    externalMap: emptyTotals(),
    documentData: emptyTotals(),
    serviceWorker: emptyTotals(),
    telemetry: emptyTotals(),
    other: emptyTotals(),
    total: emptyTotals(),
  };
}

export function addTotals(
  breakdown: PerfByteBreakdown,
  category: PerfByteCategory,
  added: PerfByteTotals,
): void {
  const categoryTotals = breakdown[CATEGORY_KEYS[category]];
  for (const totals of [categoryTotals, breakdown.total]) {
    totals.encodedBytes += added.encodedBytes;
    totals.decodedBytes += added.decodedBytes;
    totals.requestCount += added.requestCount;
  }
}

export function requestBytesAt(request: MutableNetworkRequest, timestamp: number): PerfByteTotals {
  const receivedEncodedBytes = request.chunks.reduce((sum, chunk) => sum + chunk.encodedBytes, 0);
  const responseOverhead = Math.max(0, (request.encodedBytes ?? 0) - receivedEncodedBytes);
  let encodedBytes =
    request.responseAt !== null && request.responseAt <= timestamp ? responseOverhead : 0;
  let decodedBytes = 0;
  for (const chunk of request.chunks) {
    if (chunk.timestamp > timestamp) continue;
    encodedBytes += chunk.encodedBytes;
    decodedBytes += chunk.decodedBytes;
  }
  return {
    encodedBytes:
      request.encodedBytes === null ? encodedBytes : Math.min(request.encodedBytes, encodedBytes),
    decodedBytes,
    requestCount: request.startedAt <= timestamp ? 1 : 0,
  };
}

export function completedBytes(request: MutableNetworkRequest): PerfByteTotals {
  if (request.encodedBytes === null) {
    throw new Error(
      `Automatic request ${request.url} has no authoritative encodedDataLength from CDP.`,
    );
  }
  return {
    encodedBytes: request.encodedBytes,
    decodedBytes: request.chunks.reduce((sum, chunk) => sum + chunk.decodedBytes, 0),
    requestCount: 1,
  };
}
