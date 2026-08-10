import {
  appendImportedNetworks,
  subdivideImportTile,
  tileImportArea,
} from '@transitmapper/core/model/import-area';
import {
  osmElementsToNetwork,
  parseOsmElementsPayload,
  type ImportBBox,
  type OsmWayElement,
} from '@transitmapper/core/model/import';
import type { OsmImportEvent, OsmImportRequest } from './osm-import-protocol';

interface OsmGatewayError {
  code?: unknown;
  error?: unknown;
  retryable?: unknown;
}

interface OsmImportRuntimeDependencies {
  fetcher?: typeof fetch;
  emit: (event: OsmImportEvent) => void;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}

interface TileFailure {
  code: string;
  message: string;
  retryAfterMs?: number;
}

const BATCH_TILE_COUNT = 5;
const BATCH_WAY_COUNT = 10_000;
const ADAPTIVE_FAILURES = new Set(['tile_too_dense', 'upstream_timeout', 'upstream_busy']);

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('OpenStreetMap import canceled.', 'AbortError');
}

async function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal ? abortError(signal) : new DOMException('Canceled.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryAfterMilliseconds(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function tileUrl(tile: ImportBBox, categories: OsmImportRequest['categories']): string {
  const parameters = new URLSearchParams({
    west: String(tile.west),
    south: String(tile.south),
    east: String(tile.east),
    north: String(tile.north),
    categories: categories.join(','),
  });
  return `/api/openstreetmap/ways?${parameters}`;
}

async function fetchTile(
  tile: ImportBBox,
  request: OsmImportRequest,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<{ elements?: OsmWayElement[]; failure?: TileFailure }> {
  let response: Response;
  try {
    response = await fetcher(tileUrl(tile, request.categories), { signal });
  } catch (error) {
    if (signal?.aborted) throw abortError(signal);
    return {
      failure: {
        code: 'upstream_busy',
        message:
          error instanceof Error ? error.message : 'OpenStreetMap is temporarily unavailable.',
      },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      failure: { code: 'upstream_invalid', message: 'OpenStreetMap returned an invalid response.' },
    };
  }
  if (!response.ok) {
    const error = payload as OsmGatewayError;
    return {
      failure: {
        code: typeof error.code === 'string' ? error.code : 'upstream_invalid',
        message:
          typeof error.error === 'string' ? error.error : 'OpenStreetMap import request failed.',
        retryAfterMs: retryAfterMilliseconds(response),
      },
    };
  }
  const elementsPayload =
    payload && typeof payload === 'object'
      ? (payload as { elements?: unknown }).elements
      : undefined;
  let elements: OsmWayElement[];
  try {
    elements = parseOsmElementsPayload(elementsPayload);
  } catch {
    return {
      failure: { code: 'upstream_invalid', message: 'OpenStreetMap returned an invalid response.' },
    };
  }
  return { elements };
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

type TileResult = Awaited<ReturnType<typeof fetchTile>>;

interface TileRuntime {
  fetcher: typeof fetch;
  sleep: NonNullable<OsmImportRuntimeDependencies['sleep']>;
  signal?: AbortSignal;
}

async function fetchTileWithRetries(
  tile: ImportBBox,
  request: OsmImportRequest,
  runtime: TileRuntime,
): Promise<TileResult> {
  let result = await fetchTile(tile, request, runtime.fetcher, runtime.signal);
  if (result.failure?.code !== 'upstream_busy') return result;
  for (const fallbackDelay of [2000, 5000]) {
    await runtime.sleep(result.failure.retryAfterMs ?? fallbackDelay, runtime.signal);
    result = await fetchTile(tile, request, runtime.fetcher, runtime.signal);
    if (result.failure?.code !== 'upstream_busy') break;
  }
  return result;
}

interface ImportState {
  queue: ImportBBox[];
  activeTile?: ImportBBox;
  missedTiles: ImportBBox[];
  totalTiles: number;
  completedTiles: number;
  convertedWays: number;
  pendingTiles: number;
  pendingWays: number;
  pendingNetworks: ReturnType<typeof osmElementsToNetwork>[];
}

function importProgress(request: OsmImportRequest, state: ImportState) {
  return {
    operationId: request.operationId,
    completedTiles: state.completedTiles,
    totalTiles: state.totalTiles,
    convertedWays: state.convertedWays,
  };
}

function flushImportBatch(
  request: OsmImportRequest,
  state: ImportState,
  emit: OsmImportRuntimeDependencies['emit'],
): void {
  if (state.pendingNetworks.length === 0) return;
  const { network } = appendImportedNetworks(state.pendingNetworks);
  emit({ type: 'batch', ...importProgress(request, state), network });
  state.pendingNetworks = [];
  state.pendingTiles = 0;
  state.pendingWays = 0;
}

function acceptTile(
  request: OsmImportRequest,
  state: ImportState,
  elements: OsmWayElement[],
  emit: OsmImportRuntimeDependencies['emit'],
): void {
  const network = osmElementsToNetwork(elements, request.drivingSide);
  state.pendingNetworks.push(network);
  state.pendingTiles++;
  state.pendingWays += network.ways.length;
  state.completedTiles++;
  state.convertedWays += network.ways.length;
  emit({ type: 'progress', ...importProgress(request, state) });
  if (state.pendingTiles >= BATCH_TILE_COUNT || state.pendingWays >= BATCH_WAY_COUNT) {
    flushImportBatch(request, state, emit);
  }
}

function recordTileFailure(tile: ImportBBox, failure: TileFailure, state: ImportState): void {
  if (!ADAPTIVE_FAILURES.has(failure.code)) throw new Error(failure.message);
  const children = subdivideImportTile(tile);
  if (children.length === 0) {
    state.missedTiles.push(tile);
    return;
  }
  state.totalTiles += children.length - 1;
  state.queue.unshift(...children);
}

async function processNextTile(
  request: OsmImportRequest,
  state: ImportState,
  runtime: TileRuntime,
  emit: OsmImportRuntimeDependencies['emit'],
): Promise<void> {
  const tile = state.queue.shift();
  if (!tile) return;
  state.activeTile = tile;
  const result = await fetchTileWithRetries(tile, request, runtime);
  if (result.elements) {
    acceptTile(request, state, result.elements, emit);
    state.activeTile = undefined;
    return;
  }
  if (!result.failure) throw new Error('OpenStreetMap import returned no result.');
  recordTileFailure(tile, result.failure, state);
  state.activeTile = undefined;
}

/** Sequential adaptive import engine, shared by the real Worker and unit tests. */
export async function runOsmImport(
  request: OsmImportRequest,
  dependencies: OsmImportRuntimeDependencies,
): Promise<void> {
  const signal = dependencies.signal;
  const runtime: TileRuntime = {
    fetcher: dependencies.fetcher ?? fetch,
    sleep: dependencies.sleep ?? defaultSleep,
    ...(signal ? { signal } : {}),
  };
  const initialTiles = request.tiles ?? tileImportArea(request.bounds);
  const state: ImportState = {
    queue: [...initialTiles],
    missedTiles: [],
    totalTiles: initialTiles.length,
    completedTiles: 0,
    convertedWays: 0,
    pendingTiles: 0,
    pendingWays: 0,
    pendingNetworks: [],
  };

  try {
    while (state.queue.length > 0) {
      if (signal?.aborted) throw abortError(signal);
      await processNextTile(request, state, runtime, dependencies.emit);
    }

    flushImportBatch(request, state, dependencies.emit);
    dependencies.emit({
      type: 'done',
      ...importProgress(request, state),
      missedTiles: state.missedTiles,
    });
  } catch (error) {
    flushImportBatch(request, state, dependencies.emit);
    dependencies.emit({
      type: isCancellation(error, signal) ? 'canceled' : 'error',
      ...importProgress(request, state),
      missedTiles: [
        ...state.missedTiles,
        ...(state.activeTile ? [state.activeTile] : []),
        ...state.queue,
      ],
      message:
        error instanceof Error
          ? error.message
          : isCancellation(error, signal)
            ? 'OpenStreetMap import canceled.'
            : 'OpenStreetMap import failed.',
    });
  }
}
