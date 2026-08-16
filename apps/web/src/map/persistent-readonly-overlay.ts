interface PresentValue<Value> {
  readonly present: true;
  readonly value: Value;
}

interface RemovedValue {
  readonly present: false;
}

type DeltaValue<Value> = PresentValue<Value> | RemovedValue;

interface DeltaNode<Key extends string, Value> {
  readonly key: Key;
  readonly value: DeltaValue<Value>;
  readonly left: DeltaNode<Key, Value> | null;
  readonly right: DeltaNode<Key, Value> | null;
  readonly height: number;
  readonly count: number;
}

const REMOVED: RemovedValue = { present: false };

function height<Key extends string, Value>(node: DeltaNode<Key, Value> | null): number {
  return node?.height ?? 0;
}

function count<Key extends string, Value>(node: DeltaNode<Key, Value> | null): number {
  return node?.count ?? 0;
}

function deltaNode<Key extends string, Value>(
  key: Key,
  value: DeltaValue<Value>,
  left: DeltaNode<Key, Value> | null,
  right: DeltaNode<Key, Value> | null,
): DeltaNode<Key, Value> {
  return {
    key,
    value,
    left,
    right,
    height: Math.max(height(left), height(right)) + 1,
    count: count(left) + count(right) + 1,
  };
}

function rotateLeft<Key extends string, Value>(node: DeltaNode<Key, Value>): DeltaNode<Key, Value> {
  const right = node.right;
  if (!right) return node;
  return deltaNode(
    right.key,
    right.value,
    deltaNode(node.key, node.value, node.left, right.left),
    right.right,
  );
}

function rotateRight<Key extends string, Value>(
  node: DeltaNode<Key, Value>,
): DeltaNode<Key, Value> {
  const left = node.left;
  if (!left) return node;
  return deltaNode(
    left.key,
    left.value,
    left.left,
    deltaNode(node.key, node.value, left.right, node.right),
  );
}

function balance<Key extends string, Value>(node: DeltaNode<Key, Value>): DeltaNode<Key, Value> {
  const factor = height(node.left) - height(node.right);
  if (factor > 1) {
    const left = node.left;
    if (!left) return node;
    const nextLeft = height(left.left) < height(left.right) ? rotateLeft(left) : left;
    return rotateRight(deltaNode(node.key, node.value, nextLeft, node.right));
  }
  if (factor < -1) {
    const right = node.right;
    if (!right) return node;
    const nextRight = height(right.right) < height(right.left) ? rotateRight(right) : right;
    return rotateLeft(deltaNode(node.key, node.value, node.left, nextRight));
  }
  return node;
}

function setDelta<Key extends string, Value>(
  node: DeltaNode<Key, Value> | null,
  key: Key,
  value: DeltaValue<Value>,
): DeltaNode<Key, Value> {
  if (!node) return deltaNode(key, value, null, null);
  const comparison = key.localeCompare(node.key);
  if (comparison === 0) return deltaNode(key, value, node.left, node.right);
  return balance(
    comparison < 0
      ? deltaNode(node.key, node.value, setDelta(node.left, key, value), node.right)
      : deltaNode(node.key, node.value, node.left, setDelta(node.right, key, value)),
  );
}

function deleteDelta<Key extends string, Value>(
  node: DeltaNode<Key, Value> | null,
  key: Key,
): DeltaNode<Key, Value> | null {
  if (!node) return null;
  const comparison = key.localeCompare(node.key);
  if (comparison < 0) {
    return balance(deltaNode(node.key, node.value, deleteDelta(node.left, key), node.right));
  }
  if (comparison > 0) {
    return balance(deltaNode(node.key, node.value, node.left, deleteDelta(node.right, key)));
  }
  if (!node.left) return node.right;
  if (!node.right) return node.left;
  let successor = node.right;
  while (successor.left) successor = successor.left;
  return balance(
    deltaNode(successor.key, successor.value, node.left, deleteDelta(node.right, successor.key)),
  );
}

function findDelta<Key extends string, Value>(
  root: DeltaNode<Key, Value> | null,
  key: Key,
): DeltaValue<Value> | undefined {
  let current = root;
  while (current) {
    const comparison = key.localeCompare(current.key);
    if (comparison === 0) return current.value;
    current = comparison < 0 ? current.left : current.right;
  }
  return undefined;
}

function* deltaEntries<Key extends string, Value>(
  node: DeltaNode<Key, Value> | null,
): Generator<readonly [Key, DeltaValue<Value>]> {
  if (!node) return;
  yield* deltaEntries(node.left);
  yield [node.key, node.value] as const;
  yield* deltaEntries(node.right);
}

const STREAMING_ENTRIES: unique symbol = Symbol('streamingEntries');

interface StreamingEntries<Key, Value> {
  [STREAMING_ENTRIES](): Iterator<readonly [Key, Value]>;
}

function hasStreamingEntries<Key, Value>(
  value: ReadonlyMap<Key, Value>,
): value is ReadonlyMap<Key, Value> & StreamingEntries<Key, Value> {
  return STREAMING_ENTRIES in value;
}

class PersistentOverlayMap<Key extends string, Value> implements ReadonlyMap<Key, Value> {
  readonly [Symbol.toStringTag] = 'Map';
  private readonly stableBase: ReadonlyMap<Key, Value>;
  private readonly root: DeltaNode<Key, Value> | null;
  readonly size: number;

  constructor(
    base: ReadonlyMap<Key, Value>,
    updates: ReadonlyMap<Key, Value>,
    removals: ReadonlySet<Key>,
  ) {
    const prior =
      base instanceof PersistentOverlayMap ? (base as PersistentOverlayMap<Key, Value>) : null;
    this.stableBase = prior?.stableBase ?? base;
    let root = prior?.root ?? null;
    let size = base.size;
    const currentHas = (key: Key): boolean => {
      const delta = findDelta(root, key);
      return delta ? delta.present : this.stableBase.has(key);
    };
    for (const key of removals) {
      if (currentHas(key)) size -= 1;
      root = this.stableBase.has(key) ? setDelta(root, key, REMOVED) : deleteDelta(root, key);
    }
    for (const [key, value] of updates) {
      if (!currentHas(key)) size += 1;
      root =
        this.stableBase.has(key) && this.stableBase.get(key) === value
          ? deleteDelta(root, key)
          : setDelta(root, key, { present: true, value });
    }
    this.root = root;
    this.size = size;
  }

  get deltaEntryCount(): number {
    return count(this.root);
  }

  get(key: Key): Value | undefined {
    const delta = findDelta(this.root, key);
    return delta ? (delta.present ? delta.value : undefined) : this.stableBase.get(key);
  }

  has(key: Key): boolean {
    const delta = findDelta(this.root, key);
    return delta ? delta.present : this.stableBase.has(key);
  }

  entries(): MapIterator<[Key, Value]> {
    return this.materialize().entries();
  }

  keys(): MapIterator<Key> {
    return this.materialize().keys();
  }

  values(): MapIterator<Value> {
    return this.materialize().values();
  }

  forEach(
    callbackfn: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.materialize()) callbackfn.call(thisArg, value, key, this);
  }

  [Symbol.iterator](): MapIterator<[Key, Value]> {
    return this.entries();
  }

  [STREAMING_ENTRIES](): Iterator<readonly [Key, Value]> {
    const stableBase = this.stableBase;
    const root = this.root;
    return (function* entries() {
      for (const [key, value] of stableBase) {
        const delta = findDelta(root, key);
        if (!delta) yield [key, value] as const;
        else if (delta.present) yield [key, delta.value] as const;
      }
      for (const [key, delta] of deltaEntries(root)) {
        if (!stableBase.has(key) && delta.present) yield [key, delta.value] as const;
      }
    })();
  }

  private materialize(): Map<Key, Value> {
    const complete = new Map(this.stableBase);
    for (const [key, delta] of deltaEntries(this.root)) {
      if (delta.present) complete.set(key, delta.value);
      else complete.delete(key);
    }
    return complete;
  }
}

class SetMapView<Value extends string> implements ReadonlyMap<Value, true> {
  readonly [Symbol.toStringTag] = 'Map';

  constructor(private readonly source: ReadonlySet<Value>) {}

  get size(): number {
    return this.source.size;
  }

  get(value: Value): true | undefined {
    return this.source.has(value) ? true : undefined;
  }

  has(value: Value): boolean {
    return this.source.has(value);
  }

  entries(): MapIterator<[Value, true]> {
    return new Map([...this.source].map((value) => [value, true] as const)).entries();
  }

  keys(): MapIterator<Value> {
    return this.source.values();
  }

  values(): MapIterator<true> {
    return new Map([...this.source].map((value) => [value, true] as const)).values();
  }

  forEach(
    callbackfn: (value: true, key: Value, map: ReadonlyMap<Value, true>) => void,
    thisArg?: unknown,
  ): void {
    for (const value of this.source) callbackfn.call(thisArg, true, value, this);
  }

  [Symbol.iterator](): MapIterator<[Value, true]> {
    return this.entries();
  }
}

interface SetLike<Value> {
  readonly size: number;
  has(value: Value): boolean;
  keys(): Iterator<Value>;
}

class PersistentOverlaySet<Value extends string> implements ReadonlySet<Value> {
  readonly [Symbol.toStringTag] = 'Set';
  private readonly valuesByKey: PersistentOverlayMap<Value, true>;

  constructor(
    base: ReadonlySet<Value>,
    additions: ReadonlySet<Value>,
    removals: ReadonlySet<Value>,
  ) {
    const prior =
      base instanceof PersistentOverlaySet
        ? (base as PersistentOverlaySet<Value>).valuesByKey
        : new SetMapView(base);
    this.valuesByKey = new PersistentOverlayMap(prior, new SetMapView(additions), removals);
  }

  get size(): number {
    return this.valuesByKey.size;
  }

  get deltaEntryCount(): number {
    return this.valuesByKey.deltaEntryCount;
  }

  has(value: Value): boolean {
    return this.valuesByKey.has(value);
  }

  entries(): SetIterator<[Value, Value]> {
    return new Set(this.valuesByKey.keys()).entries();
  }

  keys(): SetIterator<Value> {
    return this.values();
  }

  values(): SetIterator<Value> {
    return new Set(this.valuesByKey.keys()).values();
  }

  forEach(
    callbackfn: (value: Value, value2: Value, set: ReadonlySet<Value>) => void,
    thisArg?: unknown,
  ): void {
    for (const value of this.values()) callbackfn.call(thisArg, value, value, this);
  }

  [Symbol.iterator](): SetIterator<Value> {
    return this.values();
  }

  union<Other>(other: SetLike<Other>): Set<Value | Other> {
    const union = new Set<Value | Other>(this.values());
    const iterator = other.keys();
    for (let entry = iterator.next(); !entry.done; entry = iterator.next()) {
      union.add(entry.value);
    }
    return union;
  }

  intersection<Other>(other: SetLike<Other>): Set<Value & Other> {
    const intersection = new Set<Value & Other>();
    const comparable = other as SetLike<unknown>;
    for (const value of this.values()) {
      if (comparable.has(value)) intersection.add(value as Value & Other);
    }
    return intersection;
  }

  difference<Other>(other: SetLike<Other>): Set<Value> {
    const difference = new Set<Value>();
    const comparable = other as SetLike<unknown>;
    for (const value of this.values()) {
      if (!comparable.has(value)) difference.add(value);
    }
    return difference;
  }

  symmetricDifference<Other>(other: SetLike<Other>): Set<Value | Other> {
    const difference = new Set<Value | Other>(this.difference(other));
    const iterator = other.keys();
    for (let entry = iterator.next(); !entry.done; entry = iterator.next()) {
      if (!this.has(entry.value as unknown as Value)) difference.add(entry.value);
    }
    return difference;
  }

  isSubsetOf(other: SetLike<unknown>): boolean {
    for (const value of this.values()) if (!other.has(value)) return false;
    return true;
  }

  isSupersetOf(other: SetLike<unknown>): boolean {
    const iterator = other.keys();
    for (let entry = iterator.next(); !entry.done; entry = iterator.next()) {
      if (!this.has(entry.value as Value)) return false;
    }
    return true;
  }

  isDisjointFrom(other: SetLike<unknown>): boolean {
    const iterator = other.keys();
    for (let entry = iterator.next(); !entry.done; entry = iterator.next()) {
      if (this.has(entry.value as Value)) return false;
    }
    return true;
  }
}

export function overlayReadonlyMap<Key extends string, Value>(
  base: ReadonlyMap<Key, Value>,
  updates: ReadonlyMap<Key, Value>,
  removals: ReadonlySet<Key>,
): ReadonlyMap<Key, Value> {
  return updates.size === 0 && removals.size === 0
    ? base
    : new PersistentOverlayMap(base, updates, removals);
}

export function overlayReadonlySet<Value extends string>(
  base: ReadonlySet<Value>,
  additions: ReadonlySet<Value>,
  removals: ReadonlySet<Value>,
  _size: number,
): ReadonlySet<Value> {
  return additions.size === 0 && removals.size === 0
    ? base
    : new PersistentOverlaySet(base, additions, removals);
}

export function persistentReadonlyOverlayEntryCount(value: object): number {
  if (value instanceof PersistentOverlayMap) return value.deltaEntryCount;
  if (value instanceof PersistentOverlaySet) return value.deltaEntryCount;
  return 0;
}

export function isPersistentReadonlyOverlay(value: object): boolean {
  return value instanceof PersistentOverlayMap || value instanceof PersistentOverlaySet;
}

export function streamingReadonlyMapEntries<Key extends string, Value>(
  value: ReadonlyMap<Key, Value>,
): Iterator<readonly [Key, Value]> {
  return hasStreamingEntries(value) ? value[STREAMING_ENTRIES]() : value.entries();
}
