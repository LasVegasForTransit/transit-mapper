import type { Dispatch, SetStateAction } from 'react';
import type { PublishedGtfsFeed } from '@transitmapper/core/model/gtfs-feed';
import type { EditorCommands } from '../editor/store';
import type { ImportProgress } from '../ui/UiProvider';
import {
  backgroundImportBlockMessage,
  type BackgroundImportStore,
} from './background-import-store';
import { reconcileGtfs } from './reconcile-gtfs';
import { streamGtfsFeedBatches } from './stream-gtfs-feed';
import { waitForQuiet } from './waitForQuiet';

type SetImportProgress = Dispatch<SetStateAction<ImportProgress | null>>;

export interface StartGtfsImportOptions {
  feed: PublishedGtfsFeed;
  store: BackgroundImportStore;
  commands: EditorCommands['imports'];
  setImportProgress: SetImportProgress;
  onStarted: () => void;
}

interface ImportRun extends StartGtfsImportOptions {
  operationId: number;
  targetSystemId: string;
  controller: AbortController;
  cancel: () => void;
}

interface ImportedFeedSummary {
  routesTotal: number;
  serviceIds: string[];
}

let nextImportOperationId = 0;

function signalError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The GTFS import was canceled.', 'AbortError');
}

function abortImport(run: ImportRun, message: string): never {
  const reason = new DOMException(message, 'AbortError');
  run.controller.abort(reason);
  throw reason;
}

function requireAcceptedBatch(run: ImportRun, accepted: boolean): void {
  if (accepted) return;
  const blocked = backgroundImportBlockMessage(run.store, run.targetSystemId, run.feed.name);
  abortImport(
    run,
    blocked ?? `${run.feed.name} import stopped because the target rejected this batch.`,
  );
}

async function importFeedBatches(run: ImportRun): Promise<ImportedFeedSummary> {
  let routesTotal = 0;
  const serviceIds: string[] = [];
  for await (const { pieces, routesDone, routesTotal: total } of streamGtfsFeedBatches({
    feed: run.feed,
    signal: run.controller.signal,
    onPhase: (phase) => {
      if (phase === 'downloading') return;
      run.setImportProgress({
        operationId: run.operationId,
        label:
          phase === 'inflate-and-index'
            ? `Preparing ${run.feed.name} route data…`
            : `Building ${run.feed.name} routes…`,
        done: 0,
        total: routesTotal,
        state: 'loading',
        cancel: run.cancel,
      });
    },
  })) {
    requireAcceptedBatch(
      run,
      run.commands.applyGtfsImportBatch({ targetSystemId: run.targetSystemId, pieces }),
    );
    serviceIds.push(...pieces.services.map((service) => service.id));
    routesTotal = total;
    run.setImportProgress({
      operationId: run.operationId,
      label: `Importing ${run.feed.name}`,
      done: routesDone,
      total,
      state: 'loading',
      cancel: run.cancel,
    });
  }
  return { routesTotal, serviceIds };
}

async function reconcileImportedFeed(run: ImportRun, summary: ImportedFeedSummary): Promise<void> {
  for (;;) {
    if (run.controller.signal.aborted) throw signalError(run.controller.signal);
    const expectedSystem = run.store.getState().system;
    const attempt = new AbortController();
    const relayCancel = () => attempt.abort(signalError(run.controller.signal));
    run.controller.signal.addEventListener('abort', relayCancel, { once: true });
    const unsubscribe = run.store.subscribe((state) => {
      if (state.system !== expectedSystem) {
        attempt.abort(new DOMException('Editing superseded this snapshot.', 'AbortError'));
      }
    });
    try {
      const result = await reconcileGtfs(expectedSystem, summary.serviceIds, {
        signal: attempt.signal,
      });
      if (run.commands.applyImportedReconciliation({ expectedSystem, result })) return;
      const blocked = backgroundImportBlockMessage(run.store, run.targetSystemId, run.feed.name);
      if (blocked) abortImport(run, blocked);
    } catch (error) {
      if (!attempt.signal.aborted) throw error;
    } finally {
      unsubscribe();
      run.controller.signal.removeEventListener('abort', relayCancel);
    }
    run.setImportProgress({
      operationId: run.operationId,
      label: 'Waiting for editing to settle before merging routes…',
      done: summary.routesTotal,
      total: summary.routesTotal,
      state: 'loading',
      cancel: run.cancel,
    });
    await waitForQuiet(run.store, { quietMs: 500, signal: run.controller.signal });
  }
}

function reportImportFailure(run: ImportRun, error: unknown): void {
  const canceled = run.controller.signal.aborted;
  const fallback = canceled
    ? `${run.feed.name} import canceled.`
    : `${run.feed.name} import failed.`;
  const message = error instanceof Error ? error.message : fallback;
  run.setImportProgress({
    operationId: run.operationId,
    label: canceled ? `${message} Routes already added remain in the original system.` : message,
    done: 0,
    total: 0,
    state: canceled ? 'canceled' : 'error',
  });
}

async function executeImport(run: ImportRun): Promise<void> {
  try {
    const summary = await importFeedBatches(run);
    run.setImportProgress({
      operationId: run.operationId,
      label: 'Merging shared infrastructure…',
      done: summary.routesTotal,
      total: summary.routesTotal,
      state: 'loading',
      cancel: run.cancel,
    });
    await reconcileImportedFeed(run, summary);
    run.setImportProgress({
      operationId: run.operationId,
      label: `Imported ${summary.routesTotal} routes from ${run.feed.name}`,
      done: summary.routesTotal,
      total: summary.routesTotal,
      state: 'done',
    });
  } catch (error) {
    reportImportFailure(run, error);
  }
}

export function startGtfsImport(options: StartGtfsImportOptions): void {
  const operationId = ++nextImportOperationId;
  const targetSystemId = options.store.getState().system.id;
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(
      new DOMException(`${options.feed.name} import canceled by the user.`, 'AbortError'),
    );
  const unsubscribe = options.store.subscribe((state) => {
    if (state.system.id === targetSystemId || controller.signal.aborted) return;
    controller.abort(
      new DOMException(
        `${options.feed.name} import stopped because a different system was opened.`,
        'AbortError',
      ),
    );
  });
  const run: ImportRun = { ...options, operationId, targetSystemId, controller, cancel };
  options.setImportProgress({
    operationId,
    label: `Downloading ${options.feed.name}…`,
    done: 0,
    total: 0,
    state: 'loading',
    cancel,
  });
  options.onStarted();
  void executeImport(run).finally(() => {
    unsubscribe();
    setTimeout(
      () =>
        options.setImportProgress((current) =>
          current?.operationId === operationId ? null : current,
        ),
      4_000,
    );
  });
}
