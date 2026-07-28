import { afterEach, describe, expect, it } from 'vitest';
import { createEmptySystem } from '@transitmapper/core/model/serialize';
import {
  hasIndexedDbLibraryHistory,
  isEmergencyLibraryCopy,
  isLocalStorageAvailable,
  loadSystemEntry,
  saveEmergencyToLibrary,
  setIndexedDbLibraryHistory,
} from './localStore';

class FakeStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('Storage disabled.', 'SecurityError');
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const originalStorage = globalThis.localStorage;

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalStorage,
  });
});

describe('local storage capability metadata', () => {
  it('probes writability without leaving a library entry behind', () => {
    const storage = new FakeStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

    expect(isLocalStorageAvailable()).toBe(true);
    expect(storage.values.size).toBe(0);
  });

  it('reports localStorage as unavailable when writes are denied', () => {
    const storage = new FakeStorage();
    storage.failWrites = true;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

    expect(isLocalStorageAvailable()).toBe(false);
  });

  it('remembers whether IndexedDB may contain migrated documents', () => {
    const storage = new FakeStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

    expect(hasIndexedDbLibraryHistory()).toBe(false);
    setIndexedDbLibraryHistory(true);
    expect(hasIndexedDbLibraryHistory()).toBe(true);
    setIndexedDbLibraryHistory(false);
    expect(hasIndexedDbLibraryHistory()).toBe(false);
  });

  it('marks an emergency snapshot in the same durable document write', () => {
    const storage = new FakeStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    const system = {
      ...createEmptySystem(),
      id: 'emergency-camera',
      viewport: { center: [-115.22, 36.1] as [number, number], zoom: 13 },
    };
    expect(saveEmergencyToLibrary(system)).toBe('saved');
    expect(isEmergencyLibraryCopy(system.id)).toBe(true);
    const loaded = loadSystemEntry(system.id);
    expect(loaded).toMatchObject({
      status: 'ok',
      system: { id: system.id, viewport: { zoom: system.viewport.zoom } },
    });
    if (loaded.status === 'ok') {
      expect(loaded.system.viewport.center[0]).toBeCloseTo(system.viewport.center[0]);
      expect(loaded.system.viewport.center[1]).toBeCloseTo(system.viewport.center[1]);
    }
  });
});
