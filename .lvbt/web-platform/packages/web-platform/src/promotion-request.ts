import { z } from 'zod';

const runSchema = z.object({
  id: z.number().int().positive(),
  display_title: z.string(),
  event: z.string(),
  head_branch: z.string(),
  path: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  run_attempt: z.number().int().positive(),
  html_url: z.url(),
});
export type PromotionRun = z.infer<typeof runSchema>;
interface Actions {
  workflow?: { titlePrefix: string; path: string; branch: string };
  dispatch: (requestId: string, runId?: string) => Promise<void>;
  listRuns: () => Promise<unknown>;
  getRun: (id: number) => Promise<unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  discoveryTimeoutMs?: number;
  completionTimeoutMs?: number;
  progress?: (run: PromotionRun) => void;
}
interface Timing {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}
async function trackedRead(
  read: () => Promise<unknown>,
  context: string,
  timing: Timing,
  deadline: number,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      const rejected = error instanceof Error && /HTTP (400|401|403|404|422)/.test(error.message);
      if (rejected || attempt >= 2 || timing.now() >= deadline)
        throw new Error(`Cannot track ${context}. Do not dispatch again; inspect GitHub Actions.`, {
          cause: error,
        });
      await timing.sleep(Math.min(5_000, deadline - timing.now()));
    }
  }
}

async function discoverRun(
  requestId: string,
  actions: Actions,
  { now, sleep }: Timing,
): Promise<PromotionRun> {
  const discoveryDeadline = now() + (actions.discoveryTimeoutMs ?? 120_000);
  for (;;) {
    const runs = z
      .object({ workflow_runs: z.array(runSchema) })
      .parse(
        await trackedRead(
          () => actions.listRuns(),
          `request ${requestId}`,
          { now, sleep },
          discoveryDeadline,
        ),
      ).workflow_runs;
    const matches = runs.filter(
      (run) =>
        run.display_title ===
          `${actions.workflow?.titlePrefix ?? 'Promote website'}: ${requestId}` &&
        run.event === 'workflow_dispatch' &&
        run.head_branch === (actions.workflow?.branch ?? 'main') &&
        run.path === (actions.workflow?.path ?? '.github/workflows/deploy-worker-candidate.yml'),
    );
    if (matches.length > 1)
      throw new Error(
        `Multiple runs match request ${requestId}. Reconcile in Actions before publishing again.`,
      );
    const selected = matches[0];
    if (selected) return selected;
    if (now() >= discoveryDeadline)
      throw new Error(
        `Dispatch unconfirmed for request ${requestId}. Do not dispatch again; reconcile this request in GitHub Actions.`,
      );
    await sleep(Math.min(5_000, discoveryDeadline - now()));
  }
}

async function waitForRun(
  selected: PromotionRun,
  actions: Actions,
  { now, sleep }: Timing,
): Promise<PromotionRun> {
  const completionDeadline = now() + (actions.completionTimeoutMs ?? 40 * 60_000);
  let lastStatus = '';
  for (;;) {
    const run = runSchema.parse(
      await trackedRead(
        () => actions.getRun(selected.id),
        selected.html_url,
        { now, sleep },
        completionDeadline,
      ),
    );
    if (
      run.id !== selected.id ||
      run.display_title !== selected.display_title ||
      run.head_branch !== (actions.workflow?.branch ?? 'main') ||
      run.path !== selected.path
    )
      throw new Error(
        'GitHub returned a different promotion run. Reconcile before publishing again.',
      );
    if (run.status !== lastStatus) {
      actions.progress?.(run);
      lastStatus = run.status;
    }
    if (run.status === 'completed') return run;
    if (now() >= completionDeadline)
      throw new Error(
        `Promotion still ${run.status}: ${run.html_url}. Do not dispatch again; inspect this run.`,
      );
    await sleep(Math.min(10_000, completionDeadline - now()));
  }
}

export async function promotionRequest(
  requestId: string,
  runId: string | undefined,
  actions: Actions,
): Promise<PromotionRun> {
  if (runId && !/^[1-9][0-9]*$/.test(runId)) throw new Error('Select an Actions run ID.');
  const timing = {
    now: actions.now ?? Date.now,
    sleep:
      actions.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
  };
  // A transport error can occur after GitHub accepts the request. Never automatically redispatch.
  try {
    await actions.dispatch(requestId, runId);
  } catch (error) {
    if (error instanceof Error && /HTTP (401|403|404|422)/.test(error.message)) throw error;
  }
  const selected = await discoverRun(requestId, actions, timing);
  return await waitForRun(selected, actions, timing);
}
