import { createEmptySystem } from '@transitmapper/core/model/serialize';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveToLibrary } from './localStore';

class FakeStorage {
  private values = new Map<string, string>();
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

describe('local persistence measurement', () => {
  it('reports serialization separately from document and index storage', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new FakeStorage(),
    });
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(12)
      .mockReturnValueOnce(15);
    const onMeasure = vi.fn();

    const outcome = saveToLibrary(createEmptySystem(), { now, onMeasure });

    expect(outcome).toBe('saved');
    expect(onMeasure).toHaveBeenCalledWith(
      expect.objectContaining({
        serializeMs: 5,
        documentWriteMs: 7,
        indexWriteMs: 3,
        outcome: 'saved',
      }),
    );
    expect(onMeasure.mock.calls[0]![0].documentBytes).toBeGreaterThan(0);
  });
});
