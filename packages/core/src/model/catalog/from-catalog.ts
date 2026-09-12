// Part of the kind catalog. See ../catalog.ts for what this data is and why
// it is data rather than union types baked into logic.

// Tolerant of unknown ids, so bad data never crashes — but `X[id] ?? fallback`
// was not enough to deliver that. `??` only fires on null/undefined, and a
// plain object lookup finds inherited members: `WAY_TYPES["constructor"]` is
// the `Object` function, not undefined, so it was returned as though it were a
// way type. Callers then read `.defaultProfile` off it and threw inside
// `parseSystem`, or worse read `.defaultWidthM` off `Object.prototype.toString`
// and got `undefined`, which became a `NaN` width and a way that silently
// rendered as nothing.
//
// Ids reach here straight from `JSON.parse` of a shared document, so this is
// hostile input, not merely unknown input. `Object.hasOwn` is the check that
// makes "unknown id" mean what the fallbacks assume it means.
export function fromCatalog<T>(table: Record<string, T>, id: string, fallback: T): T {
  return Object.hasOwn(table, id) ? table[id] : fallback;
}
