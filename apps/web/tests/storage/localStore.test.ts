import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import type { TransitSystem } from '@transitmapper/core/model/system';
import {
  deleteFromLibrary,
  hasSeenOnboarding,
  listLibrary,
  loadSystemEntry,
  markOnboardingSeen,
  migrateLegacySingleSlot,
  saveToLibrary,
} from '../../src/storage/localStore';

// storage/localStore.ts had no coverage at all, which is the wrong file to
// leave untested: the editor's only copy of a person's work is the one it
// writes here. All of it is reachable from Node with a fake Storage, so the
// absence of a DOM was never the reason.

interface FakeStorageOptions {
  /** Throw on the next write, the way a full quota does. */
  failWrites?: 'quota' | 'denied' | null;
}

class FakeStorage {
  map = new Map<string, string>();
  options: FakeStorageOptions = { failWrites: null };
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  setItem(k: string, v: string) {
    if (this.options.failWrites === 'quota') throw new DOMException('full', 'QuotaExceededError');
    if (this.options.failWrites === 'denied') throw new DOMException('nope', 'SecurityError');
    this.map.set(k, v);
  }
}

const storage = new FakeStorage();
(globalThis as unknown as { localStorage: FakeStorage }).localStorage = storage;

const sys = (over: Partial<TransitSystem> = {}) => ({
  ...createEmptySystem(),
  ...over,
});

beforeEach(() => {
  storage.map.clear();
  storage.options.failWrites = null;
});

describe('save outcomes are reported, not swallowed', () => {
  it('a successful save reports saved', () => {
    expect(saveToLibrary(sys({ id: 'a', name: 'A' }))).toBe('saved');
  });
  it('a save that hits the quota reports full', () => {
    storage.options.failWrites = 'quota';
    expect(saveToLibrary(sys({ id: 'b' }))).toBe('full');
  });
  it("a save into unavailable storage says so, rather than 'make room'", () => {
    storage.options.failWrites = 'denied';
    expect(saveToLibrary(sys({ id: 'c' }))).toBe('unavailable');
  });
});

describe('a saved system comes back; the three load states are distinguishable', () => {
  beforeEach(() => {
    saveToLibrary(sys({ id: 'a', name: 'Alpha' }));
  });

  it('a saved system loads back', () => {
    expect(loadSystemEntry('a').status).toBe('ok');
  });
  it('an id that was never saved reads as missing, not corrupt', () => {
    expect(loadSystemEntry('nope').status).toBe('missing');
  });
  it("bytes that won't parse read as corrupt, not missing", () => {
    storage.map.set('transitmapper:system:broken', '{ not json');
    expect(loadSystemEntry('broken').status).toBe('corrupt');
  });
  it('a corrupt record is not deleted by reading it', () => {
    storage.map.set('transitmapper:system:broken', '{ not json');
    loadSystemEntry('broken');
    expect(storage.getItem('transitmapper:system:broken')).not.toBeNull();
  });
});

describe('the legacy migration must not drop the old key until the copy is safe', () => {
  beforeEach(() => {
    storage.map.set('transitmapper:system', JSON.stringify(sys({ id: 'legacy', name: 'Legacy' })));
  });

  it("a legacy system is still returned when its rescue copy can't be written", () => {
    storage.options.failWrites = 'quota';
    const rescued = migrateLegacySingleSlot();
    expect(rescued?.id).toBe('legacy');
  });
  it('a failed rescue leaves the legacy key in place — it is the only copy', () => {
    storage.options.failWrites = 'quota';
    migrateLegacySingleSlot();
    expect(storage.getItem('transitmapper:system')).not.toBeNull();
  });
  it('a successful rescue removes the legacy key', () => {
    migrateLegacySingleSlot();
    expect(storage.getItem('transitmapper:system')).toBeNull();
  });
  it('a successful rescue leaves the system in the library', () => {
    migrateLegacySingleSlot();
    expect(listLibrary().some((e) => e.id === 'legacy')).toBe(true);
  });
});

describe('a system written without its index entry is still reachable', () => {
  beforeEach(() => {
    saveToLibrary(sys({ id: 'a', name: 'Alpha' }));
    storage.map.delete('transitmapper:library');
  });

  it('a system with no index entry is recovered into the library', () => {
    expect(listLibrary().some((e) => e.id === 'a')).toBe(true);
  });
  it('a recovered system keeps its real name', () => {
    expect(listLibrary().find((e) => e.id === 'a')?.name).toBe('Alpha');
  });
  it('a recovered system is loadable', () => {
    expect(loadSystemEntry('a').status).toBe('ok');
  });
});

it('an unparseable orphan is still listed, so it can be deleted', () => {
  storage.map.set('transitmapper:system:junk', '{ not json');
  expect(listLibrary().some((e) => e.id === 'junk')).toBe(true);
});

it('the library does not invent entries when storage is empty', () => {
  expect(listLibrary().length).toBe(0);
});

// Recovery must not fight deletion: the bytes go first, so a deleted system
// has nothing left for the orphan scan to find and resurrect.
describe('deletion', () => {
  beforeEach(() => {
    saveToLibrary(sys({ id: 'gone', name: 'Gone' }));
  });

  it('deleting reports success', () => {
    expect(deleteFromLibrary('gone')).toBe('saved');
  });
  it('a deleted system does not come back as an orphan', () => {
    deleteFromLibrary('gone');
    expect(listLibrary().some((e) => e.id === 'gone')).toBe(false);
  });
  it('a deleted system is really gone from storage', () => {
    deleteFromLibrary('gone');
    expect(loadSystemEntry('gone').status).toBe('missing');
  });
});

// A delete that can't write leaves the row alone rather than half-removing
// it — otherwise the entry would vanish while the bytes stayed, and the
// next listing would resurrect it, looking like a delete that undid itself.
describe("a delete that can't update the index leaves the row alone", () => {
  beforeEach(() => {
    saveToLibrary(sys({ id: 'stuck', name: 'Stuck' }));
  });

  it("a delete that can't update the index reports the failure", () => {
    storage.options.failWrites = 'quota';
    expect(deleteFromLibrary('stuck')).not.toBe('saved');
  });
  it('a failed delete leaves the system listed rather than half-removed', () => {
    storage.options.failWrites = 'quota';
    deleteFromLibrary('stuck');
    storage.options.failWrites = null;
    expect(listLibrary().some((e) => e.id === 'stuck')).toBe(true);
  });
});

// The onboarding dialog's one-time flag — a plain boolean, but a bug here
// means either "never shows" or "shows every launch forever."
describe('the onboarding one-time flag', () => {
  it('a fresh browser has not seen onboarding', () => {
    expect(hasSeenOnboarding()).toBe(false);
  });
  it('seen persists', () => {
    markOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(true);
  });
  it('unavailable storage reads as not-seen, not a throw', () => {
    storage.options.failWrites = 'denied';
    expect(hasSeenOnboarding()).toBe(false);
  });
});
