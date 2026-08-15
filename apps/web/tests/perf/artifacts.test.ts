import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { freezeCheckedBaseline, readBaseline } from '../../scripts/perf/artifacts';
import { createNetworkByteLedger } from '../../scripts/perf/network-byte-ledger';
import { createPerfReport } from '../../src/perf/report';
import { PERF_PROTOCOL } from '../../src/perf/scenarios';
import type {
  PerfFirstSessionJourney,
  PerfFirstSessionSample,
  PerfReport,
  PerfSurface,
} from '../../src/perf/types';

const COMMON_PHASES = {
  document: 20,
  shell: 30,
  documentReady: 50,
  firstSystemPaint: 80,
  interactionReady: 90,
  networkIdle: 100,
  automaticBoundary: 60_000,
};

function firstSession(
  journey: PerfFirstSessionJourney,
  surface: PerfSurface,
): PerfFirstSessionSample {
  const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
  const serviceWorkerReadyMs = surface === 'editor' ? 95 : null;
  return {
    journey,
    surface,
    cacheState: 'cold',
    milestones: {
      documentResponseEndMs: 20,
      bootstrapStartMs: 1,
      shellMountedMs: 30,
      storageReadStartMs: surface === 'editor' ? 35 : null,
      storageReadEndMs: surface === 'editor' ? 40 : null,
      deserializeStartMs: null,
      deserializeEndMs: null,
      systemCommittedMs: 50,
      mapStyleReadyMs: 70,
      firstSystemPaintMs: 80,
      interactiveMs: 90,
      networkIdleMs: 100,
      serviceWorkerReadyMs,
    },
    network: ledger.createReport({
      navigationTimeOriginMs: 1_000_000,
      automaticBoundaryMs: 60_000,
      phases: {
        ...COMMON_PHASES,
        ...(serviceWorkerReadyMs === null ? {} : { serviceWorkerReady: serviceWorkerReadyMs }),
      },
    }),
  };
}

function report(generatedAt: string) {
  return createPerfReport({
    generatedAt,
    protocol: PERF_PROTOCOL,
    scenarios: [],
    samples: [],
    firstSessions: [
      firstSession('new-user-editor', 'editor'),
      firstSession('public-share', 'share'),
      firstSession('cross-site-embed', 'embed'),
    ],
  });
}

function sessionAt(reportValue: PerfReport, index: number): PerfFirstSessionSample {
  return reportValue.firstSessions[index];
}

function reportWithHostRequest() {
  const ledger = createNetworkByteLedger({ applicationOrigin: 'https://app.test' });
  ledger.registerTarget('outer-page', 'page');
  ledger.record('outer-page', 'Network.requestWillBeSent', {
    requestId: 'host',
    timestamp: 10,
    wallTime: 999.99,
    type: 'Document',
    request: { url: 'https://host.test/first-session' },
    initiator: { type: 'other' },
  });
  ledger.record('outer-page', 'Network.responseReceived', {
    requestId: 'host',
    timestamp: 10.01,
    type: 'Document',
    response: {
      url: 'https://host.test/first-session',
      mimeType: 'text/html',
      protocol: 'h2',
      headers: {},
    },
  });
  ledger.record('outer-page', 'Network.loadingFinished', {
    requestId: 'host',
    timestamp: 10.02,
    encodedDataLength: 100,
  });
  const network = ledger.createReport({
    navigationTimeOriginMs: 1_000_000,
    automaticBoundaryMs: 60_000,
    phases: COMMON_PHASES,
  });
  const frozen = report('2026-08-13T00:00:00.000Z');
  frozen.firstSessions[2] = {
    ...sessionAt(frozen, 2),
    network,
  };
  return frozen;
}

async function writeFrozenFixture(path: string, value: unknown): Promise<void> {
  const contents = JSON.stringify(value);
  const checksum = createHash('sha256').update(contents).digest('hex');
  await Promise.all([
    writeFile(path, contents, 'utf8'),
    writeFile(`${path}.sha256`, `${checksum}\n`, 'utf8'),
  ]);
}

describe('the checked performance baseline', () => {
  it('is created once and cannot be refreshed in place', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = report('2026-08-13T00:00:00.000Z');

    await freezeCheckedBaseline(path, frozen);
    await expect(
      freezeCheckedBaseline(path, report('2026-08-14T00:00:00.000Z')),
    ).rejects.toMatchObject({ code: 'EEXIST' });

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(frozen);
    expect(await readdir(directory)).toEqual(['baseline.json', 'baseline.json.sha256']);
  });

  it('detects an in-place edit to a frozen baseline', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-tamper-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = report('2026-08-13T00:00:00.000Z');
    await freezeCheckedBaseline(path, frozen);
    await writeFile(
      path,
      JSON.stringify({ ...frozen, generatedAt: '2026-08-14T00:00:00.000Z' }),
      'utf8',
    );

    await expect(readBaseline(path)).rejects.toThrow('integrity checksum does not match');
  });

  it('accepts only a structurally valid schema-v3 report', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-read-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = report('2026-08-13T00:00:00.000Z');
    await writeFrozenFixture(path, frozen);

    await expect(readBaseline(path)).resolves.toEqual(frozen);
  });

  it('rejects an obsolete report schema instead of comparing unlike contracts', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-version-'));
    const path = resolve(directory, 'baseline.json');
    await writeFrozenFixture(path, {
      ...report('2026-08-13T00:00:00.000Z'),
      schemaVersion: 2,
    });

    await expect(readBaseline(path)).rejects.toThrow('must use schema version 3');
  });

  it('records the exact revision when a frozen report needs the legacy mark adapter', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-provenance-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = {
      ...report('2026-08-13T00:00:00.000Z'),
      provenance: {
        artifactRevision: '497a549',
        milestoneMarkSource: 'legacy-497a549-observer-v1',
      },
    };
    await writeFrozenFixture(path, frozen);

    await expect(readBaseline(path)).resolves.toMatchObject({
      provenance: frozen.provenance,
    });
  });

  it('rejects a legacy observer claim for any artifact other than its audited revision', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-provenance-invalid-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = {
      ...report('2026-08-13T00:00:00.000Z'),
      provenance: {
        artifactRevision: 'not-497a549',
        milestoneMarkSource: 'legacy-497a549-observer-v1',
      },
    };
    await writeFrozenFixture(path, frozen);

    await expect(readBaseline(path)).rejects.toThrow('legacy observer provenance requires 497a549');
  });

  it('rejects malformed gate inputs instead of silently weakening a budget', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-shape-'));
    const path = resolve(directory, 'baseline.json');
    const malformed = {
      ...report('2026-08-13T00:00:00.000Z'),
      bundles: [{ entry: 'main', rawBytes: 1, gzipBytes: -1, brotliBytes: 1 }],
    };
    await writeFrozenFixture(path, malformed);

    await expect(readBaseline(path)).rejects.toThrow('bundles[0].gzipBytes');
  });

  it('rejects a report captured outside the fixed profile protocol', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-protocol-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = report('2026-08-13T00:00:00.000Z');
    frozen.protocol = { ...frozen.protocol, cpuThrottlingRate: 1 as 4 };
    await writeFrozenFixture(path, frozen);

    await expect(readBaseline(path)).rejects.toThrow('protocol does not match the fixed desktop');
  });

  it('rejects a first-session window shorter than the 60-second contract', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-window-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = reportWithHostRequest();
    sessionAt(frozen, 0).network.automaticBoundaryMs = 1_000;
    await writeFrozenFixture(path, frozen);

    await expect(readBaseline(path)).rejects.toThrow('automaticBoundaryMs must be 60000');
  });

  it('retains host requests that precede a measured iframe navigation origin', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-pre-origin-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = reportWithHostRequest();
    await writeFrozenFixture(path, frozen);

    const reread = await readBaseline(path);
    expect(reread?.firstSessions[2]?.network.requests[0]?.startedAtMs).toBeLessThan(0);
  });

  it('rejects aggregate byte totals that contradict the authoritative requests', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-request-total-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = reportWithHostRequest();
    const network = sessionAt(frozen, 2).network;
    network.total.other.encodedBytes += 1;
    network.total.total.encodedBytes += 1;
    await writeFrozenFixture(path, frozen);

    await expect(readBaseline(path)).rejects.toThrow(
      'does not equal its authoritative request sum',
    );
  });

  it('requires one cold baseline sample for every public surface journey', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-matrix-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = report('2026-08-13T00:00:00.000Z');
    frozen.firstSessions.pop();
    await writeFrozenFixture(path, frozen);

    await expect(readBaseline(path)).rejects.toThrow('exactly one cold cross-site-embed sample');
  });

  it('rejects duplicate first-session comparison samples', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-duplicate-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = report('2026-08-13T00:00:00.000Z');
    frozen.firstSessions.push(structuredClone(sessionAt(frozen, 0)));
    await writeFrozenFixture(path, frozen);

    await expect(readBaseline(path)).rejects.toThrow('duplicate cold new-user-editor sample');
  });

  it('rejects a first-session journey assigned to the wrong surface', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-surface-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = report('2026-08-13T00:00:00.000Z');
    sessionAt(frozen, 1).surface = 'editor';
    await writeFrozenFixture(path, frozen);

    await expect(readBaseline(path)).rejects.toThrow('public-share must use the share surface');
  });

  it('rejects an unsettled sample as frozen comparison evidence', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-unsettled-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = report('2026-08-13T00:00:00.000Z');
    sessionAt(frozen, 0).network.settled = false;
    sessionAt(frozen, 0).network.unsettledNonMapRequestCount = 1;
    await writeFrozenFixture(path, frozen);

    await expect(readBaseline(path)).rejects.toThrow('firstSessions[0].network must be settled');
  });

  it('rejects a frozen sample that omits a required phase', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'tm-perf-baseline-phase-'));
    const path = resolve(directory, 'baseline.json');
    const frozen = report('2026-08-13T00:00:00.000Z');
    delete sessionAt(frozen, 1).network.phases.firstSystemPaint;
    await writeFrozenFixture(path, frozen);

    await expect(readBaseline(path)).rejects.toThrow(
      'firstSessions[1].network.phases.firstSystemPaint is required',
    );
  });
});
