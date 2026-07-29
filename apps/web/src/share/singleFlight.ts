// Run-one-at-a-time with a latest-wins queue.
//
// The motivating case is the "c" (Capture PNG) shortcut. Each invocation builds
// a whole offscreen MapLibre instance with its own WebGL context and a 20s
// timeout, and the old fire-and-forget call meant OS key auto-repeat could
// start ~30 of them in a second — past the browser's live-context cap, at which
// point it starts killing the OLDEST contexts, which is the editor's own map.
//
// Dropping the extra requests would be the wrong fix: a request the user made
// must not vanish. But running all of them is not what they asked for either.
// An export request is ABSOLUTE state — a newer request supersedes an older one
// — so the correct shape is single-flight with one pending slot that the latest
// request overwrites. "Edit, c, edit, c" therefore exports the SECOND edit,
// which is the only answer that is both responsive and correct.
//
// Deliberately pure and DOM-free so apps/web/tests/verify.ts can drive it.

export interface SingleFlight<A extends unknown[]> {
  /** Start `run` if idle, otherwise replace the queued request. */
  call(...args: A): void;
  /** True while a run is in flight. */
  readonly busy: boolean;
  /** True while a request is queued behind the in-flight one. */
  readonly pending: boolean;
}

/** Wrap an async operation so at most one runs at a time, and at most one is
 *  queued behind it. `run` is expected to report its own failures; a rejection
 *  is swallowed here only so it cannot wedge the gate shut forever. */
export function singleFlight<A extends unknown[]>(
  run: (...args: A) => Promise<unknown>,
): SingleFlight<A> {
  let busy = false;
  let queued: A | null = null;

  const start = async (args: A): Promise<void> => {
    busy = true;
    try {
      await run(...args);
    } catch {
      // Intentionally empty — see the doc comment above.
    } finally {
      busy = false;
      const next = queued;
      queued = null;
      // Async recursion, so this does not grow the stack.
      if (next) void start(next);
    }
  };

  return {
    call(...args: A) {
      if (busy) {
        queued = args;
        return;
      }
      void start(args);
    },
    get busy() {
      return busy;
    },
    get pending() {
      return queued !== null;
    },
  };
}
