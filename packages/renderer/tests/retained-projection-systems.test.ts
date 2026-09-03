import { describe, expect, it } from 'vitest';
import { aSystem } from '@transitmapper/core/testing/fixtures';
import { createRetainedProjectionSystems } from '../src/workers/retained-projection-systems';

describe('Retained projection systems', () => {
  it('returns the System a request carried and holds it for the next request', () => {
    const retained = createRetainedProjectionSystems();
    const system = aSystem({ id: 'retained-system' });

    expect(retained.resolve({ kind: 'sent', system }, 'system')).toBe(system);
    expect(retained.resolve({ kind: 'retained' }, 'system')).toBe(system);
  });

  it('replaces what it holds when a later request carries a different System', () => {
    const retained = createRetainedProjectionSystems();
    const first = aSystem({ id: 'retained-system' });
    const second = aSystem({ id: 'retained-system' });

    retained.resolve({ kind: 'sent', system: first }, 'system');
    retained.resolve({ kind: 'sent', system: second }, 'system');

    expect(retained.resolve({ kind: 'retained' }, 'system')).toBe(second);
  });

  it('keeps authored and schematic geometry in separate slots', () => {
    const retained = createRetainedProjectionSystems();
    const authored = aSystem({ id: 'retained-system' });
    // What `computeDiagramSystem` returns: the same id and `updatedAt` as its
    // authored original, so only the slot says which geometry this is.
    const laidOut = { ...authored };

    retained.resolve({ kind: 'sent', system: authored }, 'system');
    retained.resolve({ kind: 'sent', system: laidOut }, 'diagramSystem');

    expect(retained.resolve({ kind: 'retained' }, 'system')).toBe(authored);
    expect(retained.resolve({ kind: 'retained' }, 'diagramSystem')).toBe(laidOut);
  });

  it('refuses a request naming a System this worker was never sent', () => {
    const retained = createRetainedProjectionSystems();

    expect(() => retained.resolve({ kind: 'retained' }, 'system')).toThrow(
      'Feature projection Worker holds no retained system.',
    );
  });

  it('refuses a Diagram request when only the authored System was sent', () => {
    const retained = createRetainedProjectionSystems();
    retained.resolve({ kind: 'sent', system: aSystem({ id: 'retained-system' }) }, 'system');

    expect(() => retained.resolve({ kind: 'retained' }, 'diagramSystem')).toThrow(
      'Feature projection Worker holds no retained diagramSystem.',
    );
  });
});
