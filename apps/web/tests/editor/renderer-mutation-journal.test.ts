import { describe, expect, it } from 'vitest';
import { aRoad, aStop, aSystem } from '@transitmapper/core/testing/fixtures';
import { renderPreparationPatchBetween } from '@transitmapper/core/render/render-preparation-journal';
import { createEditorStore } from '../../src/editor/store';

describe('editor renderer mutation journal', () => {
  it('journals a one-corridor property edit with the exact replacement object', () => {
    const way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    const previous = aSystem({ ways: [way] });
    const store = createEditorStore();
    store.commands.document.setSystem(previous);

    store.commands.ways.setWayGrade('way', 'elevated');

    const next = store.getState().system;
    expect(renderPreparationPatchBetween(previous, next)).toEqual({
      ways: { upsert: [next.ways[0]] },
    });
  });

  it('retains station collection identity and journals an unanchored geometry edit', () => {
    const way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    const previous = aSystem({ ways: [way] });
    const store = createEditorStore();
    store.commands.document.setSystem(previous);

    store.commands.ways.addWayPoint('way', [2, 0]);

    const next = store.getState().system;
    expect(next.stations).toBe(previous.stations);
    expect(renderPreparationPatchBetween(previous, next)).toEqual({
      ways: { upsert: [next.ways[0]] },
    });
  });

  it('journals a point insertion at the final immutable system identity', () => {
    const way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    const arm = aRoad('arm', [
      [1, 0],
      [1, 1],
    ]);
    const previous = aSystem({
      ways: [way, arm],
      nodes: [
        {
          id: 'junction',
          coord: [1, 0],
          refs: [
            { wayId: 'way', pointIndex: 1 },
            { wayId: 'arm', pointIndex: 0 },
          ],
        },
      ],
    });
    const store = createEditorStore();
    store.commands.document.setSystem(previous);

    store.commands.ways.insertWayPoint('way', 0, [-1, 0]);

    const next = store.getState().system;
    expect(renderPreparationPatchBetween(previous, next)).toEqual({
      ways: { upsert: [next.ways[0]] },
      nodes: { upsert: next.nodes },
    });
  });

  it('journals a point deletion at the final immutable system identity', () => {
    const way = aRoad('way', [
      [-1, 0],
      [0, 0],
      [1, 0],
    ]);
    const arm = aRoad('arm', [
      [1, 0],
      [1, 1],
    ]);
    const previous = aSystem({
      ways: [way, arm],
      nodes: [
        {
          id: 'junction',
          coord: [1, 0],
          refs: [
            { wayId: 'way', pointIndex: 2 },
            { wayId: 'arm', pointIndex: 0 },
          ],
        },
      ],
    });
    const store = createEditorStore();
    store.commands.document.setSystem(previous);

    store.commands.ways.deleteWayPoint('way', 0);

    const next = store.getState().system;
    expect(renderPreparationPatchBetween(previous, next)).toEqual({
      ways: { upsert: [next.ways[0]] },
      nodes: { upsert: next.nodes },
    });
  });

  it('journals both incident ways and the node after a junction cascade move', () => {
    const west = aRoad('west', [
      [0, 0],
      [1, 0],
    ]);
    const north = aRoad('north', [
      [1, 0],
      [1, 1],
    ]);
    const previous = aSystem({
      ways: [west, north],
      stops: [aStop('west-stop', [0.5, 0], { wayId: 'west', t: 0.5 })],
      nodes: [
        {
          id: 'junction',
          coord: [1, 0],
          refs: [
            { wayId: 'west', pointIndex: 1 },
            { wayId: 'north', pointIndex: 0 },
          ],
        },
      ],
    });
    const store = createEditorStore();
    store.commands.document.setSystem(previous);

    store.commands.ways.moveWayPoint('west', 1, [1.1, 0.1]);

    const next = store.getState().system;
    expect(renderPreparationPatchBetween(previous, next)).toEqual({
      ways: { upsert: next.ways },
      nodes: { upsert: next.nodes },
      stops: { upsert: next.stops },
    });
  });

  it('journals an anchored Stop replacement when its selected way is nudged', () => {
    const way = aRoad('way', [
      [0, 0],
      [1, 0],
    ]);
    const previous = aSystem({
      ways: [way],
      stops: [aStop('stop', [0.5, 0], { wayId: 'way', t: 0.5 })],
    });
    const store = createEditorStore();
    store.commands.document.setSystem(previous);
    store.commands.selection.toggleMultiSelect({ kind: 'way', id: 'way' });

    store.commands.selection.nudgeMultiSelection(0.1, 0.1);

    const next = store.getState().system;
    expect(renderPreparationPatchBetween(previous, next)).toEqual({
      ways: { upsert: [next.ways[0]] },
      stops: { upsert: next.stops },
    });
  });

  it('retains journal lineage while straightening repeated point removals', () => {
    const way = aRoad('way', [
      [0, 0],
      [0.25, 0.1],
      [0.75, -0.1],
      [1, 0],
    ]);
    const previous = aSystem({ ways: [way] });
    const store = createEditorStore();
    store.commands.document.setSystem(previous);

    store.commands.ways.straightenWay('way');

    const next = store.getState().system;
    expect(renderPreparationPatchBetween(previous, next)).toEqual({
      ways: { upsert: [next.ways[0]] },
    });
  });

  it('journals both ways and the new node when joining a point to a way', () => {
    const target = aRoad('target', [
      [0, 0],
      [1, 0],
    ]);
    const branch = aRoad('branch', [
      [0.5, 1],
      [0.5, 0],
    ]);
    const previous = aSystem({ ways: [target, branch] });
    const store = createEditorStore();
    store.commands.document.setSystem(previous);

    store.commands.ways.joinWayPointToWay('branch', 1, 'target', [0.5, 0]);

    const next = store.getState().system;
    expect(renderPreparationPatchBetween(previous, next)).toEqual({
      ways: { upsert: next.ways },
      nodes: { upsert: next.nodes },
    });
  });
});
