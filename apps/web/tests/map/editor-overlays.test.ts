import { describe, expect, it } from 'vitest';
import type { Selection } from '../../src/editor/store';
import {
  canApplyEditorSourceUpdate,
  editorSourcesNeedSystemRefresh,
  planSelectionRenderUpdate,
  type SelectionRenderState,
} from '../../src/map/editor-overlays';

function state(
  selection: Selection,
  overrides: Partial<SelectionRenderState> = {},
): SelectionRenderState {
  return {
    selection,
    activeWayId: null,
    activePatternId: null,
    armedTerminus: null,
    ...overrides,
  };
}

describe('selection render updates', () => {
  it('never lets an editor-only shell become the first retained live scene', () => {
    expect(canApplyEditorSourceUpdate(false, false)).toBe(false);
    expect(canApplyEditorSourceUpdate(true, true)).toBe(false);
    expect(canApplyEditorSourceUpdate(true, false)).toBe(true);
  });

  it('keeps ordinary and junction selection changes on lightweight editor sources', () => {
    for (const selection of [
      { kind: 'station', id: 'station-a' },
      { kind: 'facility', id: 'facility-a' },
      { kind: 'node', id: 'node-a' },
    ] satisfies Exclude<Selection, null>[]) {
      expect(planSelectionRenderUpdate(state(null), state(selection))).toEqual({
        updateEditorSources: true,
        updateServiceTermini: false,
      });
    }
  });

  it('refreshes termini only when visible service-owned state changes', () => {
    const selected = state({ kind: 'service', id: 'service-a' }, { activePatternId: 'pattern-a' });
    const armed = {
      serviceId: 'service-a',
      patternId: 'pattern-a',
      side: 'end' as const,
    };

    expect(planSelectionRenderUpdate(state(null), selected).updateServiceTermini).toBe(true);
    expect(planSelectionRenderUpdate(selected, state(null)).updateServiceTermini).toBe(true);
    expect(
      planSelectionRenderUpdate(
        selected,
        state({ kind: 'service', id: 'service-b' }, { activePatternId: 'pattern-a' }),
      ).updateServiceTermini,
    ).toBe(true);
    expect(
      planSelectionRenderUpdate(selected, { ...selected, activePatternId: 'pattern-b' })
        .updateServiceTermini,
    ).toBe(true);
    expect(
      planSelectionRenderUpdate(selected, { ...selected, armedTerminus: armed })
        .updateServiceTermini,
    ).toBe(true);
  });

  it('does not reproject termini for unrelated clicks or semantically identical state', () => {
    const before = state({ kind: 'station', id: 'station-a' });
    const after = state({ kind: 'facility', id: 'facility-a' });
    expect(planSelectionRenderUpdate(before, after)).toEqual({
      updateEditorSources: true,
      updateServiceTermini: false,
    });

    const sameService = state(
      { kind: 'service', id: 'service-a' },
      {
        activePatternId: 'pattern-a',
        armedTerminus: {
          serviceId: 'service-a',
          patternId: 'pattern-a',
          side: 'start',
        },
      },
    );
    const armedTerminus = sameService.armedTerminus;
    if (!armedTerminus) throw new Error('fixture must include an armed terminus');
    expect(
      planSelectionRenderUpdate(sameService, {
        ...sameService,
        selection: { kind: 'service', id: 'service-a' },
        armedTerminus: { ...armedTerminus },
      }),
    ).toEqual({ updateEditorSources: false, updateServiceTermini: false });
  });

  it('updates editor handles without termini when only the active way changes', () => {
    expect(planSelectionRenderUpdate(state(null), state(null, { activeWayId: 'way-a' }))).toEqual({
      updateEditorSources: true,
      updateServiceTermini: false,
    });
  });

  it('refreshes editor-owned geometry after selected entity and route mutations', () => {
    for (const changedSources of [
      ['tm-handles'],
      ['tm-physical-handles'],
      ['tm-service-termini'],
    ] as const) {
      expect(editorSourcesNeedSystemRefresh(changedSources, false)).toBe(true);
    }
    expect(editorSourcesNeedSystemRefresh(['tm-facilities'], false)).toBe(false);
    expect(editorSourcesNeedSystemRefresh([], true)).toBe(true);
  });
});
