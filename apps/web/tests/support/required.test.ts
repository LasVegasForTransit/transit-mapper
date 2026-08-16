// Excluded from the test run by vitest.config.ts (`tests/support/**`). Shared
// throw-guard for store commands that legitimately return `null` on a
// failure path (`beginWay`, `addStop`, `addFacility`, `createGroup`, …) —
// every call site across these tests is on the success path, so a `null`
// here means the test's own setup is broken and should fail loudly rather
// than propagate `null` downstream.
export function required<T>(value: T | null, what = 'a non-null result'): T {
  if (value === null) throw new Error(`expected ${what}`);
  return value;
}
