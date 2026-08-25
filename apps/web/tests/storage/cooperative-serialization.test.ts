import { aStop, aSystem } from '@transitmapper/core/testing/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { serializeSystemCooperatively } from '../../src/storage/cooperative-serialization';

describe('cooperative document serialization', () => {
  it('preserves JSON semantics while yielding between entity batches', async () => {
    const system = aSystem({
      id: 'large',
      description: undefined,
      stops: Array.from({ length: 40 }, (_, index) =>
        aStop(`stop-${index}`, [-115.2 + index / 10_000, 36.1], undefined, {
          name: `Stop ${index}`,
        }),
      ),
    });
    let time = 0;
    const yieldControl = vi.fn(() => Promise.resolve());

    const serialized = await serializeSystemCooperatively(system, {
      now: () => ++time,
      yieldControl,
      sliceMs: 4,
    });

    expect(serialized).toBe(JSON.stringify(system));
    expect(yieldControl).toHaveBeenCalled();
  });
});
