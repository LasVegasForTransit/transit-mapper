import { expect, it } from 'vitest';
import { SortedRunMerge } from '../src/scene-draft-work';

function complete<Value>(merge: SortedRunMerge<Value>): readonly Value[] {
  for (;;) {
    const unit = merge.nextWork();
    if (!unit) return merge.result();
    unit.run();
  }
}

it('merges many interleaved runs in deterministic comparator and run order', () => {
  const runCount = 257;
  const runs = Array.from({ length: runCount }, (_, runIndex) =>
    Array.from({ length: 17 }, (_, offset) => ({
      key: offset * runCount + (runIndex % 31),
      runIndex,
      offset,
    })),
  );
  const expected = runs
    .flat()
    .sort((left, right) => left.key - right.key || left.runIndex - right.runIndex);
  const merge = new SortedRunMerge({
    id: 'deterministic-parity',
    runs,
    compare: (left, right) => left.key - right.key,
    batchSize: 3,
  });

  expect(complete(merge)).toEqual(expected);
});

it('deduplicates equal primitive values across runs without changing sort order', () => {
  const merge = new SortedRunMerge({
    id: 'unique-parity',
    runs: [
      ['alpha', 'charlie'],
      ['alpha', 'bravo', 'charlie'],
      ['bravo', 'delta'],
    ],
    compare: (left, right) => left.localeCompare(right),
    batchSize: 1,
    unique: true,
  });

  expect(complete(merge)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
});
