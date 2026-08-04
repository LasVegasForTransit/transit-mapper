import { describe, expect, it } from 'vitest';
import { aRoad, aSystem } from '../support/fixtures.test';
import {
  createCrossingOperationCounts,
  crossingsWithoutJoiningChunked,
  findCrossingsWithoutJoining,
  findMismatchedTypeJunctions,
  validateSystemQuick,
  type Issue,
} from '../../src/model/validate';
import type { TransitSystem } from '../../src/model/system';

async function collectCrossingIssues(generator: AsyncGenerator<Issue[]>): Promise<Issue[]> {
  const issues: Issue[] = [];
  for await (const batch of generator) issues.push(...batch);
  return issues;
}

describe('chunked crossing validation', () => {
  it('can cancel while the spatial grid is still being built', async () => {
    const points = Array.from({ length: 200 }, (_, index): [number, number] => [
      -115.2004 + index * 0.00005,
      36.1002,
    ]);
    const system = aSystem({ ways: [aRoad('long', points)] });
    const operations = createCrossingOperationCounts();
    const cancellation = new AbortController();

    await collectCrossingIssues(
      crossingsWithoutJoiningChunked(system, {
        operationBudget: 4,
        operations,
        signal: cancellation.signal,
        yieldControl: async () => {
          cancellation.abort();
        },
      }),
    );

    expect(operations.yields).toBe(1);
    expect(operations.cancellations).toBe(1);
    expect(operations.gridSegments).toBeLessThan(points.length - 1);
    expect(operations.querySegments).toBe(0);
  });

  it('can cancel inside one dense candidate bucket', async () => {
    const ways = Array.from({ length: 80 }, (_, index) => {
      const latitude = 36.1002 + index * 0.000001;
      return aRoad(`parallel-${index}`, [
        [-115.2004, latitude],
        [-115.2002, latitude],
      ]);
    });
    const system = aSystem({ ways });
    const operations = createCrossingOperationCounts();
    const cancellation = new AbortController();

    await collectCrossingIssues(
      crossingsWithoutJoiningChunked(system, {
        operationBudget: 8,
        operations,
        signal: cancellation.signal,
        yieldControl: async () => {
          if (operations.candidateChecks > 0) cancellation.abort();
        },
      }),
    );

    expect(operations.gridSegments).toBe(ways.length);
    expect(operations.querySegments).toBe(1);
    expect(operations.candidateChecks).toBeGreaterThan(0);
    expect(operations.candidateChecks).toBeLessThan(ways.length);
    expect(operations.cancellations).toBe(1);
  });

  it('returns the expected issues with deterministic operation counts', async () => {
    const system = aSystem({
      ways: [
        aRoad('horizontal', [
          [-115.2004, 36.1002],
          [-115.1984, 36.1002],
        ]),
        aRoad('vertical', [
          [-115.1994, 36.0992],
          [-115.1994, 36.1012],
        ]),
        aRoad('clear', [
          [-115.1974, 36.0992],
          [-115.1974, 36.1012],
        ]),
      ],
    });
    const firstOperations = createCrossingOperationCounts();
    const secondOperations = createCrossingOperationCounts();
    const expectedTargets = [
      {
        id: 'crossing-horizontal|vertical',
        target: { kind: 'way' as const, id: 'horizontal' },
      },
    ];

    const first = await collectCrossingIssues(
      crossingsWithoutJoiningChunked(system, {
        operationBudget: 2,
        operations: firstOperations,
        yieldControl: async () => {},
      }),
    );
    const second = await collectCrossingIssues(
      crossingsWithoutJoiningChunked(system, {
        operationBudget: 2,
        operations: secondOperations,
        yieldControl: async () => {},
      }),
    );

    const synchronous = findCrossingsWithoutJoining(system);
    expect(synchronous.map(({ id, target }) => ({ id, target }))).toEqual(expectedTargets);
    expect(first.map(({ id, target }) => ({ id, target }))).toEqual(expectedTargets);
    expect(second).toEqual(first);
    expect(secondOperations).toEqual(firstOperations);
  });
});

// A junction is a lane graph, so its arms have to be the same kind of way.
// Nothing forms a mixed one any more; these are documents that already have
// one, from the crossing bug or from a pre-v4 load deriving nodes by bare
// coordinate coincidence.
describe('junctions joining different way types', () => {
  const road = aRoad('russell', [
    [-115.2, 36.1],
    [-115.18, 36.1],
  ]);
  const rail = aRoad('charleston', [
    [-115.19, 36.09],
    [-115.19, 36.11],
  ]);

  function junctionOf(typeId: string): TransitSystem {
    return aSystem({
      ways: [road, { ...rail, typeId }],
      nodes: [
        {
          id: 'n',
          coord: [-115.19, 36.1],
          refs: [
            { wayId: 'russell', pointIndex: 1 },
            { wayId: 'charleston', pointIndex: 0 },
          ],
        },
      ],
    });
  }

  it('are reported, pointing at the junction so clicking one selects it', () => {
    const issues = findMismatchedTypeJunctions(junctionOf('heavyRail'));
    expect(issues.map(({ id, target }) => ({ id, target }))).toEqual([
      { id: 'mixed-junction-n', target: { kind: 'node', id: 'n' } },
    ]);
    // Catalog labels, never the catalog's ids: nobody drawing a network
    // should be shown the string "heavyRail".
    expect(issues[0].message).toContain('Road');
    expect(issues[0].message).toContain('Heavy rail');
    expect(issues[0].message).not.toContain('heavyRail');
  });

  it('are not reported when every arm is the same type', () => {
    expect(findMismatchedTypeJunctions(junctionOf('road'))).toEqual([]);
  });

  it('reach the reactive tier, since the fix is one click away in the inspector', () => {
    expect(validateSystemQuick(junctionOf('heavyRail')).map((i) => i.id)).toContain(
      'mixed-junction-n',
    );
  });

  it('are gone once the mismatched arm stops referencing the junction', () => {
    const system = junctionOf('heavyRail');
    const disconnected = {
      ...system,
      nodes: system.nodes.map((n) => ({
        ...n,
        refs: n.refs.filter((r) => r.wayId !== 'charleston'),
      })),
    };
    expect(findMismatchedTypeJunctions(disconnected)).toEqual([]);
  });
});
