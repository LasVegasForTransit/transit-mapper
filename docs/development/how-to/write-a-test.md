# Write a test

`pnpm verify` runs everything. There are two suites and they are not
interchangeable.

## Adding to an existing suite

`apps/worker/tests/verify.test.ts` is a sequential script. One store is
built at module scope and mutated in order, so each section depends on
the state the sections above it left behind.

Add beside related cases, in the same style:

```ts
check('deleting a way removes its service', servicesOnWay(wayId).length === 0);
```

The name is the entire failure message, so write it as the rule it enforces
— not "test delete" but "deleting a way removes its service".

**Do not split this file up piecemeal.** The shared sequential state means
a section moved to another file silently tests something different. Splitting
it is a rewrite, not a refactor.

`apps/web/tests/verify.test.ts` no longer exists — its cases were split into
independent Vitest files under `apps/web/tests/`, mirroring the area of
`src/` (or, for logic in `@transitmapper/core`, the area of
`packages/core/src/`) each case covers. Add new web-side cases as ordinary
`describe`/`it` blocks in the relevant file below, or a new file if none
exists yet — never as an appended sequential check.

## Adding a new test file

Put each new isolated Vitest case in the owning module's `tests/` tree,
mirroring the production area it covers:

```text
<module>/
  src/
    map/interactions.ts
  tests/
    map/interactions.test.ts
```

Test support belongs in `tests/support/`. Test imports cross explicitly into
`src/`; do not make production code reach into test support. For example, a
test in `tests/share/claim.test.ts` imports its subject from
`../../src/share/claim`.

Every file under `tests/` uses exactly `<name>.test.ts` or
`<name>.test.tsx`, including sequential verifiers and support modules.
End-to-end files under `tests/e2e/` instead use exactly `<name>.spec.ts` or
`<name>.spec.tsx`. A filename cannot contain another dot, and no other file
type belongs under `tests/`.

Write the case as ordinary isolated Vitest:

```ts
import { describe, expect, it } from 'vitest';

describe('claimOutcome', () => {
  it('keeps a share the server has not answered about', () => {
    expect(claimOutcome(pending)).toBe('retry');
  });
});
```

Every Vitest config discovers `tests/**/*.test.{ts,tsx}`. Configs exclude
`tests/support/`, which is imported by tests rather than run directly; the
worker's config also excludes its sequential verifier, which is executed
directly instead. Keeping all test material under this one boundary makes
the runner configuration and the repository check agree about what must
run. These Vitest globs deliberately exclude end-to-end specs.

## Testing the Worker

`apps/worker/tests/shares.test.ts` runs in **real workerd against a real D1**,
with the production migrations applied — not a mock. That means a test can
exercise actual SQL, actual bindings, and actual request handling:

```ts
const response = await worker.fetch(request, env, createExecutionContext());
expect(response.status).toBe(400);
```

This is the suite that matters most. The Worker is the only component that
reads bytes from strangers.

## What to test first

Start at the untrusted-input boundary, not the happy path. The cases worth
the most are the ones asserting that bad input is rejected — a system that
is not an object, an id containing SQL metacharacters, a body over the size
cap.

Where a behaviour is deliberate but surprising, pin it with a test and say
so in a comment. `POST /api/systems` accepting any object-shaped body is
recorded that way, so that if it ever changes, it changes on purpose.
