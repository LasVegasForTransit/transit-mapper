# Write a test

`pnpm verify` runs everything. There are two suites and they are not
interchangeable.

## Adding to an existing suite

`apps/web/scripts/verify.ts` and `apps/worker/scripts/verify.ts` are
sequential scripts. One store is built at module scope and mutated in order,
so each section depends on the state the sections above it left behind.

Add beside related cases, in the same style:

```ts
check('deleting a way removes its service', servicesOnWay(wayId).length === 0);
```

The name is the entire failure message, so write it as the rule it enforces
— not "test delete" but "deleting a way removes its service".

**Do not split these files up piecemeal.** The shared sequential state means
a section moved to another file silently tests something different. Splitting
them is a rewrite, not a refactor.

## Adding a new test file

Anything new goes in a `*.test.ts` file as ordinary isolated Vitest cases:

```ts
import { describe, expect, it } from 'vitest';

describe('claimOutcome', () => {
  it('keeps a share the server has not answered about', () => {
    expect(claimOutcome(pending)).toBe('retry');
  });
});
```

Vitest picks up `src/**/*.test.ts` in every package.

## Testing the Worker

`apps/worker/src/shares.test.ts` runs in **real workerd against a real D1**,
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
