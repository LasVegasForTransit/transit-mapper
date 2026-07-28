export async function reloadAfterFlush(
  flushPendingSave: () => void | Promise<void>,
  updateServiceWorker: () => void | Promise<void>,
): Promise<void> {
  await flushPendingSave();
  await updateServiceWorker();
}
