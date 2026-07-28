// Why a merge that looks obvious is not on offer.
//
// Actions that do not apply are hidden, which is right for the common case —
// two unrelated objects should not show four greyed-out merges. It is wrong
// for the near miss: two streets that visibly cross, or two lines that end at
// the same corner, look mergeable and offering nothing reads as a bug. So the
// inspector carries one sentence naming the property that blocked it. This is
// a note, never a menu entry, and it only speaks about a pair.

import {
  crossesAtDifferentGrades,
  terminiMeet,
} from '@transitmapper/core/model/selectionRelations';
import type { SelectionRef } from '@transitmapper/core/model/selectionActions';
import type { TransitSystem } from '@transitmapper/core/model/system';

export function blockedMergeNote(system: TransitSystem, refs: SelectionRef[]): string | null {
  if (refs.length !== 2) return null;
  const [first, second] = refs;
  if (first.kind !== second.kind) return null;

  if (first.kind === 'way') {
    if (crossesAtDifferentGrades(system, first.id, second.id)) {
      return 'These cross at different grades, so one passes over the other. Put them at the same grade to connect them.';
    }
    return null;
  }

  if (first.kind === 'service') {
    const a = system.services.find((s) => s.id === first.id);
    const b = system.services.find((s) => s.id === second.id);
    if (!a || !b) return null;
    if (a.modeId !== b.modeId && terminiMeet(system, a.id, b.id)) {
      return `“${a.name}” and “${b.name}” meet, but they run different modes and can't become one line.`;
    }
  }

  return null;
}
