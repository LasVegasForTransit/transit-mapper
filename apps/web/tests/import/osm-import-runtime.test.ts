import { describe, expect, it, vi } from 'vitest';
import type { ImportBBox } from '@transitmapper/core/model/import';
import { runOsmImport } from '../../src/import/osm-import-runtime';
import type { OsmImportEvent, OsmImportRequest } from '../../src/import/osm-import-protocol';

const tile = (west: number): ImportBBox => ({ west, south: 36, east: west + 0.001, north: 36.001 });

function success(id: number): Response {
  return Response.json({
    elements: [
      {
        type: 'way',
        id,
        tags: { highway: 'residential' },
        nodes: [id * 2, id * 2 + 1],
        geometry: [
          { lat: 36, lon: -115 },
          { lat: 36.001, lon: -114.999 },
        ],
      },
    ],
  });
}

function request(tiles: ImportBBox[]): OsmImportRequest {
  return {
    operationId: 1,
    targetSystemId: 'system-1',
    bounds: tiles[0],
    tiles,
    categories: ['road'],
    drivingSide: 'right',
  };
}

describe('runOsmImport', () => {
  it('fetches one tile at a time and emits a batch after five completed tiles', async () => {
    let active = 0;
    let maximumActive = 0;
    let nextId = 1;
    const fetcher = vi.fn(async () => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active--;
      return success(nextId++);
    }) as typeof fetch;
    const events: OsmImportEvent[] = [];

    await runOsmImport(
      request([
        tile(-115.06),
        tile(-115.05),
        tile(-115.04),
        tile(-115.03),
        tile(-115.02),
        tile(-115.01),
      ]),
      {
        fetcher,
        emit: (event) => events.push(event),
        sleep: () => Promise.resolve(),
      },
    );

    expect(maximumActive).toBe(1);
    expect(
      events.filter((event) => event.type === 'batch').map((event) => event.network.ways.length),
    ).toEqual([5, 1]);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      completedTiles: 6,
      totalTiles: 6,
      missedTiles: [],
    });
  });

  it('respects retry timing, then subdivides a repeatedly busy tile into four', async () => {
    const delays: number[] = [];
    let nextSuccessfulWay = 100;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { code: 'upstream_busy', error: 'busy', retryable: true },
          { status: 503, headers: { 'retry-after': '3' } },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ code: 'upstream_busy', error: 'busy', retryable: true }, { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({ code: 'upstream_busy', error: 'busy', retryable: true }, { status: 503 }),
      )
      .mockImplementation(() => Promise.resolve(success(nextSuccessfulWay++))) as typeof fetch;
    const events: OsmImportEvent[] = [];

    await runOsmImport(request([{ west: -115.2, south: 36, east: -115.1, north: 36.1 }]), {
      fetcher,
      emit: (event) => events.push(event),
      sleep: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    });

    expect(delays).toEqual([3000, 5000]);
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      completedTiles: 4,
      totalTiles: 4,
      missedTiles: [],
    });
  });

  it('flushes completed pending work when cancellation stops the next tile', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetcher = vi.fn(() => {
      calls++;
      if (calls === 1) return Promise.resolve(success(1));
      const error = new DOMException('Canceled by the user.', 'AbortError');
      controller.abort(error);
      return Promise.reject(error);
    }) as typeof fetch;
    const events: OsmImportEvent[] = [];

    await runOsmImport(request([tile(-115.02), tile(-115.01)]), {
      fetcher,
      emit: (event) => events.push(event),
      sleep: () => Promise.resolve(),
      signal: controller.signal,
    });

    expect(events.find((event) => event.type === 'batch')).toMatchObject({
      type: 'batch',
      network: { ways: [{ source: 'osm:1' }] },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'canceled',
      completedTiles: 1,
      missedTiles: [tile(-115.01)],
    });
  });

  it('flushes a completed tile and reports malformed successful payloads as errors', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(success(1))
      .mockResolvedValueOnce(Response.json({ remark: 'missing elements' })) as typeof fetch;
    const events: OsmImportEvent[] = [];

    await runOsmImport(request([tile(-115.02), tile(-115.01)]), {
      fetcher,
      emit: (event) => events.push(event),
      sleep: () => Promise.resolve(),
    });

    expect(events.find((event) => event.type === 'batch')).toMatchObject({
      type: 'batch',
      network: { ways: [{ source: 'osm:1' }] },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      message: 'OpenStreetMap returned an invalid response.',
      missedTiles: [tile(-115.01)],
    });
  });
});
