/** A copy-on-write map layer used by prepared renderer snapshots.
 *
 * Entity edits add one small overlay instead of cloning an RTC-sized Map.
 * Iteration is intentionally available for compatibility, but hot renderer
 * paths should use keyed lookup or authoritative candidate ID arrays. */
export class RenderPreparationMap<K, V> implements ReadonlyMap<K, V> {
  readonly [Symbol.toStringTag] = 'Map';
  private materialized: ReadonlyMap<K, V> | null = null;

  constructor(
    private readonly base: ReadonlyMap<K, V> | null,
    private readonly upserts: ReadonlyMap<K, V>,
    private readonly removals: ReadonlySet<K>,
    readonly size: number,
  ) {}

  get(key: K): V | undefined {
    if (this.removals.has(key)) return undefined;
    const replacement = this.upserts.get(key);
    return replacement ?? this.base?.get(key);
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  entries(): MapIterator<[K, V]> {
    return this.materialize().entries();
  }

  keys(): MapIterator<K> {
    return this.materialize().keys();
  }

  values(): MapIterator<V> {
    return this.materialize().values();
  }

  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.materialize()) callbackfn.call(thisArg, value, key, this);
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  private materialize(): ReadonlyMap<K, V> {
    if (this.materialized) return this.materialized;
    const values = new Map(this.base ?? []);
    for (const key of this.removals) values.delete(key);
    for (const [key, value] of this.upserts) values.set(key, value);
    this.materialized = values;
    return values;
  }
}

const PREPARATION_HASH_SHARD_COUNT = 256;

function preparationHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
}

/** A cooperatively populated string-key map whose individual hash tables stay
 * small. Hash-addressed shards keep lookup constant-time; separately bounded
 * insertion-order chunks avoid a monolithic array resize pause. */
export class RenderPreparationMutableMap<K extends string, V> implements ReadonlyMap<K, V> {
  readonly [Symbol.toStringTag] = 'Map';
  private readonly shards = new Array<Map<K, V> | undefined>(PREPARATION_HASH_SHARD_COUNT);
  private readonly orderedKeyShards: K[][] = [[]];
  private entryCount = 0;

  constructor(private readonly maximumShardSize = 64) {}

  get size(): number {
    return this.entryCount;
  }

  set(key: K, value: V): this {
    const shardIndex = preparationHash(key) % PREPARATION_HASH_SHARD_COUNT;
    let shard = this.shards[shardIndex];
    if (!shard) {
      shard = new Map();
      this.shards[shardIndex] = shard;
    }
    if (shard.has(key)) {
      shard.set(key, value);
      return this;
    }
    let orderedKeys = this.orderedKeyShards[this.orderedKeyShards.length - 1];
    if (orderedKeys.length >= this.maximumShardSize) {
      orderedKeys = [];
      this.orderedKeyShards.push(orderedKeys);
    }
    shard.set(key, value);
    orderedKeys.push(key);
    this.entryCount++;
    return this;
  }

  get(key: K): V | undefined {
    return this.shards[preparationHash(key) % PREPARATION_HASH_SHARD_COUNT]?.get(key);
  }

  has(key: K): boolean {
    return this.shards[preparationHash(key) % PREPARATION_HASH_SHARD_COUNT]?.has(key) ?? false;
  }

  *entries(): MapIterator<[K, V]> {
    for (const keys of this.orderedKeyShards) {
      for (const key of keys) yield [key, this.get(key) as V];
    }
  }

  *keys(): MapIterator<K> {
    for (const keys of this.orderedKeyShards) yield* keys;
  }

  *values(): MapIterator<V> {
    for (const keys of this.orderedKeyShards) {
      for (const key of keys) yield this.get(key) as V;
    }
  }

  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this) callbackfn.call(thisArg, value, key, this);
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }
}

export class RenderPreparationMutableSet<T extends string> {
  readonly [Symbol.toStringTag] = 'Set';
  private readonly valuesByKey = new RenderPreparationMutableMap<T, true>();

  get size(): number {
    return this.valuesByKey.size;
  }

  add(value: T): this {
    this.valuesByKey.set(value, true);
    return this;
  }

  has(value: T): boolean {
    return this.valuesByKey.has(value);
  }

  union<U>(other: RenderPreparationSetLike<U>): Set<T | U> {
    const result = new Set<T | U>(this);
    const iterator = other.keys();
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      result.add(next.value);
    }
    return result;
  }

  intersection<U>(other: RenderPreparationSetLike<U>): Set<T & U> {
    const result = new Set<T & U>();
    for (const value of this) {
      if (other.has(value as unknown as U)) result.add(value as T & U);
    }
    return result;
  }

  difference<U>(other: RenderPreparationSetLike<U>): Set<T> {
    const result = new Set<T>();
    for (const value of this) {
      if (!other.has(value as unknown as U)) result.add(value);
    }
    return result;
  }

  symmetricDifference<U>(other: RenderPreparationSetLike<U>): Set<T | U> {
    const result = new Set<T | U>(this);
    const iterator = other.keys();
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      if (this.has(next.value as unknown as T)) result.delete(next.value);
      else result.add(next.value);
    }
    return result;
  }

  isSubsetOf(other: RenderPreparationSetLike<unknown>): boolean {
    for (const value of this) if (!other.has(value)) return false;
    return true;
  }

  isSupersetOf(other: RenderPreparationSetLike<unknown>): boolean {
    const iterator = other.keys();
    for (let next = iterator.next(); !next.done; next = iterator.next()) {
      if (!this.has(next.value as T)) return false;
    }
    return true;
  }

  isDisjointFrom(other: RenderPreparationSetLike<unknown>): boolean {
    for (const value of this) if (other.has(value)) return false;
    return true;
  }

  *entries(): SetIterator<[T, T]> {
    for (const value of this.valuesByKey.keys()) yield [value, value];
  }

  keys(): SetIterator<T> {
    return this.values();
  }

  values(): SetIterator<T> {
    return this.valuesByKey.keys();
  }

  forEach(
    callbackfn: (value: T, value2: T, set: RenderPreparationMutableSet<T>) => void,
    thisArg?: unknown,
  ): void {
    for (const value of this) callbackfn.call(thisArg, value, value, this);
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.values();
  }
}

interface RenderPreparationSetLike<T> {
  readonly size: number;
  has(value: T): boolean;
  keys(): Iterator<T>;
}

export function initialRenderPreparationMap<K, V>(values: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  return values;
}

export function updateRenderPreparationMap<K, V>(
  base: ReadonlyMap<K, V>,
  upserts: ReadonlyMap<K, V>,
  removals: ReadonlySet<K>,
): ReadonlyMap<K, V> {
  // Cold preparation has already populated one mutable map cooperatively. Do
  // not walk it again merely to wrap an empty base at publication time.
  if (base.size === 0 && removals.size === 0) return upserts;
  let size = base.size;
  for (const key of removals) if (base.has(key)) size--;
  for (const key of upserts.keys()) {
    if (!base.has(key) || removals.has(key)) size++;
  }
  return new RenderPreparationMap(base, upserts, removals, size);
}
