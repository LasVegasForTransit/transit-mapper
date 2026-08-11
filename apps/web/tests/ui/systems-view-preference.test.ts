import { describe, expect, it } from 'vitest';
import {
  readSystemsView,
  writeSystemsView,
  type SystemsViewStorage,
} from '../../src/ui/systems-view-preference';

function memoryStorage(): SystemsViewStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function throwingStorage(): SystemsViewStorage {
  return {
    getItem: () => {
      throw new DOMException('Storage is unavailable.', 'SecurityError');
    },
    setItem: () => {
      throw new DOMException('Storage is unavailable.', 'SecurityError');
    },
  };
}

describe('saved-system view preference', () => {
  it('uses cards until someone chooses a view', () => {
    expect(readSystemsView(memoryStorage())).toBe('cards');
  });

  it('round-trips the selected view', () => {
    const storage = memoryStorage();

    writeSystemsView('list', storage);

    expect(readSystemsView(storage)).toBe('list');
  });

  it('ignores values outside the view vocabulary', () => {
    const storage = memoryStorage();
    storage.setItem('transitmapper:systemsView', 'gallery');

    expect(readSystemsView(storage)).toBe('cards');
  });

  it('falls back to cards when storage throws', () => {
    expect(readSystemsView(throwingStorage())).toBe('cards');
    expect(() => writeSystemsView('list', throwingStorage())).not.toThrow();
  });
});
