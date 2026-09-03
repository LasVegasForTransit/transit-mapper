import { describe, expect, it } from 'vitest';
import {
  advanceLineMaterializationSession,
  createLineMaterializationSession,
} from '../../src/line/line-materialization-session';
import { prepareLineSpanCandidateContext } from '../../src/line/line-span-candidates';
import { aLineSpanProjection } from '../support/line-spans.test';

describe('Line materialization session', () => {
  it('materializes one ranked Line partition per advancement', async () => {
    const prepared = prepareLineSpanCandidateContext(
      aLineSpanProjection({
        lineOrder: [
          { lineId: 'empty-line', rank: 0 },
          { lineId: 'line', rank: 1 },
        ],
      }),
    );
    if (prepared.kind !== 'ready') throw new Error('Expected prepared Line candidate context.');

    const first = await advanceLineMaterializationSession(
      createLineMaterializationSession({
        context: prepared.context,
        carrierRule: 'shared-alignment',
      }),
    );
    expect(first).toMatchObject({
      kind: 'advanced',
      lineId: 'empty-line',
      materialization: { kind: 'ready', spans: [], visibleFragments: [] },
    });
    if (first.kind !== 'advanced') throw new Error('Expected first Line advancement.');

    const second = await advanceLineMaterializationSession(first.next);
    expect(second).toMatchObject({ kind: 'advanced', lineId: 'line' });
    if (second.kind !== 'advanced') throw new Error('Expected second Line advancement.');
    expect(second.materialization.kind).toBe('ready');
    if (second.materialization.kind === 'ready')
      expect(second.materialization.spans).toHaveLength(1);

    await expect(advanceLineMaterializationSession(second.next)).resolves.toEqual({
      kind: 'complete',
    });
  });
});
