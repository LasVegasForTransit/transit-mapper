import { useEditor, useEditorStore } from '../editor/EditorProvider';
import { streamRtcGtfsBatches } from '../import/streamRtcGtfs';
import { reconcileRtcGtfs } from '../import/reconcileRtcGtfs';
import { waitForQuiet } from '../import/waitForQuiet';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { useImportProgress } from './UiProvider';

interface GtfsImportDialogProps {
  onClose: () => void;
}

let nextImportOperationId = 0;

/** RTC Southern Nevada's real, current bus network — imported whole (no
 *  bbox/category picker like street import: it's one fixed feed) as a
 *  comparison baseline next to whatever's being proposed. Confirming here
 *  closes this dialog immediately and hands off to ImportProgressPill: a
 *  feed this size (dozens of routes, thousands of stops) streams in over
 *  several seconds, and nothing about that should trap the user behind a
 *  modal — see streamRtcGtfsBatches for why it's batched at all. */
export function GtfsImportDialog({ onClose }: GtfsImportDialogProps) {
  const applyGtfsImportBatch = useEditor((s) => s.applyGtfsImportBatch);
  const applyImportedReconciliation = useEditor((s) => s.applyImportedReconciliation);
  const store = useEditorStore();
  const { importProgress, setImportProgress } = useImportProgress();

  const run = () => {
    if (importProgress?.state === 'loading') return;
    const operationId = ++nextImportOperationId;
    const targetSystemId = store.getState().system.id;
    const controller = new AbortController();
    const cancel = () =>
      controller.abort(new DOMException('RTC import canceled by the user.', 'AbortError'));
    const unsubscribeTarget = store.subscribe((state) => {
      if (state.system.id === targetSystemId || controller.signal.aborted) return;
      controller.abort(
        new DOMException('RTC import stopped because a different system was opened.', 'AbortError'),
      );
    });
    setImportProgress({
      operationId,
      label: 'Downloading RTC system…',
      done: 0,
      total: 0,
      state: 'loading',
      cancel,
    });
    onClose();
    (async () => {
      try {
        let routesTotal = 0;
        const importedServiceIds: string[] = [];
        for await (const { pieces, routesDone, routesTotal: total } of streamRtcGtfsBatches({
          signal: controller.signal,
          onPhase: (phase) => {
            if (phase === 'downloading') return;
            setImportProgress({
              operationId,
              label:
                phase === 'inflate-and-index'
                  ? 'Preparing RTC route data…'
                  : 'Building RTC routes…',
              done: 0,
              total: routesTotal,
              state: 'loading',
              cancel,
            });
          },
        })) {
          if (!applyGtfsImportBatch({ targetSystemId, pieces })) {
            const reason = new DOMException(
              'RTC import stopped because a different system was opened.',
              'AbortError',
            );
            controller.abort(reason);
            throw reason;
          }
          importedServiceIds.push(...pieces.services.map((s) => s.id));
          routesTotal = total;
          setImportProgress({
            operationId,
            label: 'Importing RTC system',
            done: routesDone,
            total,
            state: 'loading',
            cancel,
          });
        }
        // Corridor conflation: many of these routes share the same physical
        // streets — run once, over everything just imported, rather than per
        // batch, so routes sharing a trunk corridor conflate onto shared
        // infrastructure even when they land in different batches (batching
        // is by route order for progressive UI, not by geography).
        setImportProgress({
          operationId,
          label: 'Merging shared infrastructure…',
          done: routesTotal,
          total: routesTotal,
          state: 'loading',
          cancel,
        });
        for (;;) {
          if (controller.signal.aborted) throw controller.signal.reason;
          const expectedSystem = store.getState().system;
          const attempt = new AbortController();
          const relayCancel = () => attempt.abort(controller.signal.reason);
          controller.signal.addEventListener('abort', relayCancel, { once: true });
          const unsubscribe = store.subscribe((state) => {
            if (state.system !== expectedSystem) {
              attempt.abort(new DOMException('Editing superseded this snapshot.', 'AbortError'));
            }
          });
          try {
            const result = await reconcileRtcGtfs(expectedSystem, importedServiceIds, {
              signal: attempt.signal,
            });
            if (applyImportedReconciliation({ expectedSystem, result })) break;
          } catch (error) {
            if (controller.signal.aborted) throw controller.signal.reason;
            if (!attempt.signal.aborted) throw error;
          } finally {
            unsubscribe();
            controller.signal.removeEventListener('abort', relayCancel);
          }
          // A user edit replaced the snapshot while the Worker was running.
          // Terminate it rather than merely discarding its eventual result,
          // then wait for a complete quiet window before cloning another
          // large document into a replacement Worker.
          setImportProgress({
            operationId,
            label: 'Waiting for editing to settle before merging routes…',
            done: routesTotal,
            total: routesTotal,
            state: 'loading',
            cancel,
          });
          await waitForQuiet(store, { quietMs: 500, signal: controller.signal });
        }
        setImportProgress({
          operationId,
          label: `Imported RTC's ${routesTotal} routes`,
          done: routesTotal,
          total: routesTotal,
          state: 'done',
        });
      } catch (e) {
        const canceled = controller.signal.aborted;
        setImportProgress({
          operationId,
          label: canceled
            ? `${e instanceof Error ? e.message : 'RTC import canceled.'} Routes already added remain in the original system.`
            : e instanceof Error
              ? e.message
              : 'RTC import failed.',
          done: 0,
          total: 0,
          state: canceled ? 'canceled' : 'error',
        });
      } finally {
        unsubscribeTarget();
        setTimeout(
          () =>
            setImportProgress((current) => (current?.operationId === operationId ? null : current)),
          4000,
        );
      }
    })();
  };

  return (
    <Modal
      title="Import RTC's real system"
      description="Pull RTC Southern Nevada's current published bus network in as a comparison baseline."
      onClose={onClose}
      footer={
        <button
          className="primary-btn"
          style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}
          onClick={run}
          disabled={importProgress?.state === 'loading'}
        >
          <Icon name="download" size={18} />{' '}
          {importProgress?.state === 'loading'
            ? 'Import already running'
            : 'Import into this system'}
        </button>
      }
    >
      <p className="panel-hint">
        Pulls RTC Southern Nevada&rsquo;s published GTFS feed — every current bus route, its stops,
        and its alignment — in as real routes and stations. It streams in live on the map, a few
        routes at a time, so you can keep working while it comes in — watch for the progress pill
        above the tool dock.
      </p>
    </Modal>
  );
}
