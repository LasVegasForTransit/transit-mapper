import { createPerfProtocol } from '../../src/perf/scenarios';

type UnknownRecord = Record<string, unknown>;

function invalid(reportPath: string, detail: string): never {
  throw new Error(`Frozen PerfReport "${reportPath}" is invalid: ${detail}.`);
}

function record(value: unknown, reportPath: string, context: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(reportPath, `${context} must be an object`);
  }
  return value as UnknownRecord;
}

function nonNegativeNumber(value: unknown, reportPath: string, context: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    invalid(reportPath, `${context} must be a finite non-negative number`);
  }
}

function runCount(value: unknown, reportPath: string, context: string): void {
  nonNegativeNumber(value, reportPath, context);
  if (!Number.isSafeInteger(value)) {
    invalid(reportPath, `${context} must be a non-negative safe integer`);
  }
}

function profile(value: unknown, reportPath: string): 'desktop' | 'mobile' {
  if (value !== 'desktop' && value !== 'mobile') {
    invalid(reportPath, 'protocol.profile has an unsupported value');
  }
  return value;
}

function matchesFixedProtocol(
  protocol: UnknownRecord,
  viewport: UnknownRecord,
  network: UnknownRecord,
  profileId: 'desktop' | 'mobile',
): boolean {
  const expected = createPerfProtocol(profileId);
  const actualValues: unknown[] = [
    protocol.cpuThrottlingRate,
    viewport.width,
    viewport.height,
    viewport.deviceScaleFactor,
    network.downloadThroughputBytesPerSecond,
    network.uploadThroughputBytesPerSecond,
    network.latencyMs,
    protocol.warmupRuns,
    protocol.measuredRuns,
    protocol.warmReloadsPerMeasuredRun,
  ];
  const expectedValues: unknown[] = [
    expected.cpuThrottlingRate,
    expected.viewport.width,
    expected.viewport.height,
    expected.viewport.deviceScaleFactor,
    expected.network.downloadThroughputBytesPerSecond,
    expected.network.uploadThroughputBytesPerSecond,
    expected.network.latencyMs,
    expected.warmupRuns,
    expected.measuredRuns,
    expected.warmReloadsPerMeasuredRun,
  ];
  return actualValues.every((actual, index) => actual === expectedValues[index]);
}

export function validateFixedPerfProtocol(value: unknown, reportPath: string): void {
  const protocol = record(value, reportPath, 'protocol');
  const profileId = profile(protocol.profile, reportPath);
  if (protocol.browser !== 'Google Chrome' || protocol.browserChannel !== 'chrome') {
    invalid(reportPath, 'protocol must use the fixed Google Chrome channel');
  }
  if (protocol.headed !== true) invalid(reportPath, 'protocol.headed must be true');
  nonNegativeNumber(protocol.cpuThrottlingRate, reportPath, 'protocol.cpuThrottlingRate');
  if (protocol.cache !== 'cleared-before-cold-load-then-enabled') {
    invalid(reportPath, 'protocol.cache does not match the fixed cache contract');
  }
  const viewport = record(protocol.viewport, reportPath, 'protocol.viewport');
  for (const key of ['width', 'height', 'deviceScaleFactor']) {
    nonNegativeNumber(viewport[key], reportPath, `protocol.viewport.${key}`);
  }
  const network = record(protocol.network, reportPath, 'protocol.network');
  if (network.name !== 'Fast 4G') invalid(reportPath, 'protocol.network.name must be Fast 4G');
  for (const key of [
    'downloadThroughputBytesPerSecond',
    'uploadThroughputBytesPerSecond',
    'latencyMs',
  ]) {
    nonNegativeNumber(network[key], reportPath, `protocol.network.${key}`);
  }
  for (const key of ['warmupRuns', 'measuredRuns', 'warmReloadsPerMeasuredRun']) {
    runCount(protocol[key], reportPath, `protocol.${key}`);
  }
  if (!matchesFixedProtocol(protocol, viewport, network, profileId)) {
    invalid(reportPath, `protocol does not match the fixed ${profileId} audit profile`);
  }
}
