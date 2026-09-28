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

// Same throw-guard as `required`, but for lookups (`Array#find`, `Map#get`,
// optional-chained property access, …) that legitimately return `undefined`
// rather than `null` on a miss.
export function mustFind<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}
