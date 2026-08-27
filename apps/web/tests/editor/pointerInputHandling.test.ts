import { beforeEach, describe, expect, it } from 'vitest';
import { createEditorStore } from '../../src/editor/store';
import {
  COARSE_POINTER_TUNING,
  FINE_POINTER_TUNING,
  inputTuningFor,
} from '../../src/editor/input-tuning';
import { resolvePointerIntent } from '../../src/editor/pointerIntent';
import type { NamedWay } from '@transitmapper/core/model/system';
import { required } from '../support/required.test';

// A fingertip contact patch is 9-11mm, ~24 CSS px on a phone. Every tolerance
// the map hit-tests with has to grow with it, or a finger is asked to land
// inside a radius narrower than the finger.
describe('input tuning: coarse pointers get proportional tolerances', () => {
  it('a coarse pointer hit-tests at least a fingertip wide', () => {
    expect(COARSE_POINTER_TUNING.hitPx).toBeGreaterThanOrEqual(24);
  });

  it('snapping still reaches further than plain hit-testing', () => {
    expect(
      FINE_POINTER_TUNING.snapPx > FINE_POINTER_TUNING.hitPx &&
        COARSE_POINTER_TUNING.snapPx > COARSE_POINTER_TUNING.hitPx,
    ).toBe(true);
  });

  it('every precision tolerance grows for a coarse pointer', () => {
    expect(
      COARSE_POINTER_TUNING.hitPx > FINE_POINTER_TUNING.hitPx &&
        COARSE_POINTER_TUNING.snapPx > FINE_POINTER_TUNING.snapPx &&
        COARSE_POINTER_TUNING.dragPx > FINE_POINTER_TUNING.dragPx &&
        COARSE_POINTER_TUNING.straightSnapPx > FINE_POINTER_TUNING.straightSnapPx,
    ).toBe(true);
  });

  // Sample spacing decides how faithfully a drawn curve follows the gesture.
  // That is a question about the geometry someone wants, not about how
  // precisely they can point, so it is the one value that must NOT scale.
  it('freehand sample spacing is not a precision tolerance and does not scale', () => {
    expect(COARSE_POINTER_TUNING.freehandSamplePx).toBe(FINE_POINTER_TUNING.freehandSamplePx);
  });

  it('the fine profile is what the editor shipped with', () => {
    expect(FINE_POINTER_TUNING).toMatchObject({
      hitPx: 9,
      snapPx: 18,
      dragPx: 4,
      straightSnapPx: 10,
    });
  });

  it('inputTuningFor(false) selects the fine profile', () => {
    expect(inputTuningFor(false)).toBe(FINE_POINTER_TUNING);
  });

  it('inputTuningFor(true) selects the coarse profile', () => {
    expect(inputTuningFor(true)).toBe(COARSE_POINTER_TUNING);
  });
});

// These are named for the channel rather than the key (alternate, not alt)
// because a touchscreen latches them from the inspector instead of holding
// them. The resolver must therefore have no notion of which set it — see
// interactions.test.ts for the test that a latched channel and a held key
// reach the same dispatch.
describe('modifier channels resolve the operations their keys used to', () => {
  const base = {
    view: 'infrastructure' as const,
    tool: 'select' as const,
    armed: 'none' as const,
    gestureActive: false,
  };

  it('the alternate channel erases a control point', () => {
    expect(
      resolvePointerIntent({ ...base, target: 'control-point', modifiers: { alternate: true } })
        .primaryOperation,
    ).toBe('erase-points');
  });

  it('without a channel the same target just moves', () => {
    expect(
      resolvePointerIntent({ ...base, target: 'control-point', modifiers: {} }).primaryOperation,
    ).toBe('move-point');
  });

  it('the secondary channel splits an interior point', () => {
    expect(
      resolvePointerIntent({ ...base, target: 'interior-point', modifiers: { secondary: true } })
        .primaryOperation,
    ).toBe('split-corridor');
  });

  it('the constrain channel qualifies a move without changing the verb', () => {
    expect(
      resolvePointerIntent({ ...base, target: 'control-point', modifiers: { constrain: true } })
        .primaryOperation,
    ).toBe('constrained-move');
  });

  it('the actions channel opens the corridor menu', () => {
    expect(
      resolvePointerIntent({ ...base, target: 'corridor', modifiers: { actions: true } })
        .primaryOperation,
    ).toBe('open-corridor-actions');
  });
});

describe('the Select variant is editor state, not history', () => {
  let store: ReturnType<typeof createEditorStore>;

  beforeEach(() => {
    store = createEditorStore();
  });

  it('picking a variant arms it', () => {
    store.commands.tools.setSelectVariant('erase');
    expect(store.getState().selectVariant).toBe('erase');
  });

  it('picking a variant creates no undo step', () => {
    const before = store.getState().canUndo;
    store.commands.tools.setSelectVariant('erase');
    expect(store.getState().canUndo).toBe(before);
  });

  it('a variant switches back off', () => {
    store.commands.tools.setSelectVariant('erase');
    store.commands.tools.setSelectVariant('select');
    expect(store.getState().selectVariant).toBe('select');
  });
});

// separateCarriageways mints an identity purely to hold the two halves of a
// street together, with an empty name. Numbering a blank name gave the object
// list rows reading " 1" and " 2".
describe('an identity with no name contributes no name', () => {
  let store: ReturnType<typeof createEditorStore>;
  let unnamed: NamedWay | undefined;

  beforeEach(() => {
    store = createEditorStore();
    store.commands.tools.setDraftMode('bus');
    const w = required(store.commands.ways.beginWay('road', 'straight'));
    store.commands.ways.addWayPoint(w, [-115.3, 36.1]);
    store.commands.ways.addWayPoint(w, [-115.1, 36.1]);
    store.commands.ways.finishWay();
    store.commands.network.separateCarriageways(w);
    unnamed = store.getState().system.namedWays.find((n) => !n.name);
  });

  it('separating carriageways mints an identity with no name', () => {
    expect(unnamed).toBeDefined();
  });

  it('and that identity spans both halves', () => {
    expect(unnamed?.wayIds).toHaveLength(2);
  });

  it('naming it later still names every half', () => {
    if (!unnamed) throw new Error('setup should have minted an unnamed identity');
    const unnamedId = unnamed.id;
    const unnamedWayIds = unnamed.wayIds;
    store.commands.ways.renameNamedWay(unnamedId, 'Decatur Avenue');
    const named = store.getState().system.namedWays.find((n) => n.id === unnamedId);
    expect(named).toMatchObject({ name: 'Decatur Avenue', wayIds: unnamedWayIds });
  });
});
