/**
 * The editor's pointer vocabulary stays independent of MapLibre features so
 * presentation and dispatch make the same decision without needing a browser.
 * `interactions.ts` is responsible only for translating rendered features into
 * these target names and for carrying the resolved operation out.
 */
export type PointerTarget =
  | 'empty'
  | 'line-body'
  | 'line'
  | 'service-terminus'
  | 'terminus'
  | 'same-branch-interior'
  | 'same-mode-line'
  | 'different-mode-line'
  | 'compatible-corridor'
  | 'return-terminus'
  | 'control-point'
  | 'interior-point'
  | 'endpoint'
  | 'stop'
  | 'facility'
  | 'corridor';
/**
 * The modal channels a press can be qualified by, named for what they are
 * rather than for how they are set.
 *
 * A keyboard sets these by being held; a touch device has no modifier keys, so
 * the same channels are latched from the inspector instead (see
 * ui/inspector/modifiers.tsx). Both produce this identical shape, which is why
 * resolvePointerIntent below needs no notion of what kind of pointer it is
 * serving — that is the whole reason these are not called `alt` and `shift`.
 *
 * They are channels rather than verbs on purpose. `alternate` means erase
 * under Select and separate-corridor under the Way tool, so any verb name
 * would be accurate in one tool and a lie in the other.
 */
export interface ModifierState {
  /** `Space`. Offers camera pan over any target. */
  pan?: boolean;
  /** `Shift`. Adds a geometric constraint; the only channel legal mid-gesture. */
  constrain?: boolean;
  /** `Alt`/`Option`. Erase, or draw deliberately separate infrastructure. */
  alternate?: boolean;
  /** `Ctrl`/`⌘`. Split at an interior point, extend at an endpoint. */
  secondary?: boolean;
  /** The right button, or a long press. Opens the action anchor and its menu. */
  actions?: boolean;
}

/** A drawing state that gives the next pointer press a more specific verb. */
type ArmedInteraction = 'none' | 'network-extending' | 'network-return';

export type PointerBadge =
  | 'extend'
  | 'loop'
  | 'connect'
  | 'new'
  | 'separate'
  | 'one-way-return'
  | 'move'
  | 'constrain'
  | 'erase'
  | 'split';

export type PointerOperation =
  | 'pan'
  | 'select-line-and-branch'
  | 'extend-branch'
  | 'close-directional-loop'
  | 'connect-paths'
  | 'refuse'
  | 'route-service'
  | 'resume-service-and-corridor'
  | 'draw-service-and-corridor'
  | 'draw-separate-corridor'
  | 'draw-inbound-side'
  | 'open-line-actions'
  | 'open-terminus-actions'
  | 'move-point'
  | 'constrained-move'
  | 'move-stop'
  | 'move-facility'
  | 'delete-stop'
  | 'delete-facility'
  | 'erase-points'
  | 'split-corridor'
  | 'extend-corridor'
  | 'open-corridor-actions'
  | 'refuse-edit'
  | 'default';

export interface PointerIntent {
  primaryOperation: PointerOperation;
  cursor: 'grab' | 'grabbing' | 'default' | 'crosshair' | 'not-allowed';
  badge: PointerBadge | null;
  allowed: boolean;
  /** The renderer uses this to decide whether to show the target anchor or a
   * live draw preview. It deliberately contains no browser/map state. */
  anchor: 'none' | 'target' | 'preview';
  /** The one legal mid-drag change: Shift may alter only geometry. */
  constraint: 'none' | 'constrain';
}

export interface PointerIntentInput {
  view: 'network' | 'infrastructure' | 'diagram';
  tool: 'select' | 'lines' | 'way' | 'stop' | 'facility';
  target?: PointerTarget;
  modifiers: ModifierState;
  readOnly: boolean;
  armed: ArmedInteraction;
  gestureActive: boolean;
  /** Captured on pointer-down. During a drag, modifier changes must not turn
   * moving a point into erasing or splitting it. */
  lockedPrimaryOperation?: PointerOperation;
  /** A live routed draft can only accept another compatible corridor. It is
   * not a fresh-way gesture, even when the pointer happens to be over empty
   * ground. */
  routeDraftActive?: boolean;
}

function intent(
  primaryOperation: PointerOperation,
  cursor: PointerIntent['cursor'],
  badge: PointerBadge | null,
  allowed: boolean,
  anchor: PointerIntent['anchor'] = 'none',
  constraint: PointerIntent['constraint'] = 'none',
): PointerIntent {
  return { primaryOperation, cursor, badge, allowed, anchor, constraint };
}

/**
 * Resolve a single pointer's current meaning. Call again on every hover and
 * modifier transition; call with `lockedPrimaryOperation` after pointer-down
 * to preserve the gesture's verb while allowing Shift's geometry constraint.
 */
export function resolvePointerIntent(input: PointerIntentInput): PointerIntent {
  const target = input.target ?? 'empty';
  const { modifiers } = input;
  const constraint = input.gestureActive && modifiers.constrain ? 'constrain' : 'none';

  // Diagram coordinates are a projection and shared snapshots are immutable;
  // neither may feed an edit back into the store. Space still offers camera
  // pan, but an editable target must state its refusal explicitly.
  if (input.readOnly || input.view === 'diagram') {
    if (modifiers.pan || target === 'empty') return intent('pan', 'grab', null, true);
    return intent('refuse-edit', 'not-allowed', null, false);
  }

  // A terminus drag keeps "edit this branch" locked while its live target
  // refines the visible/committed result into extend, loop, or connect below.
  // Other gestures retain their exact pointer-down verb.
  if (
    input.gestureActive &&
    input.lockedPrimaryOperation &&
    !(
      input.view === 'network' &&
      ((input.armed === 'network-return' && input.lockedPrimaryOperation === 'draw-inbound-side') ||
        (input.armed === 'network-extending' &&
          input.lockedPrimaryOperation === 'extend-branch' &&
          (target === 'same-branch-interior' ||
            target === 'same-mode-line' ||
            target === 'different-mode-line')))
    )
  ) {
    return intent(input.lockedPrimaryOperation, 'grabbing', null, true, 'preview', constraint);
  }

  if (modifiers.actions) {
    if (target === 'terminus')
      return intent('open-terminus-actions', 'default', null, true, 'target');
    if (input.view === 'infrastructure' && target === 'corridor')
      return intent('open-corridor-actions', 'default', null, true, 'target');
    return intent('open-line-actions', 'default', null, true, 'target');
  }

  if (modifiers.pan) return intent('pan', 'grab', null, true);

  if (input.view === 'network') {
    if (input.armed === 'network-return') {
      if (target === 'different-mode-line') return intent('refuse', 'not-allowed', null, false);
      if (input.gestureActive)
        return intent('draw-inbound-side', 'crosshair', 'one-way-return', true, 'preview');
      if (target === 'return-terminus')
        return intent('draw-inbound-side', 'crosshair', 'one-way-return', true, 'target');
    }
    if (input.armed === 'network-extending') {
      if (target === 'same-branch-interior')
        return intent('close-directional-loop', 'grabbing', 'loop', true, 'target');
      if (target === 'same-mode-line')
        return intent('connect-paths', 'grabbing', 'connect', true, 'target');
      if (target === 'different-mode-line') return intent('refuse', 'not-allowed', null, false);
    }
    if (input.tool === 'way') {
      // A live route draft is already committed to sharing compatible
      // infrastructure. Alt only opts an idle Way tool into separate drawing;
      // it cannot start a physical way beside an unfinished route draft.
      if (input.routeDraftActive)
        return target === 'compatible-corridor'
          ? intent('route-service', 'crosshair', 'connect', true, 'target')
          : intent('default', 'crosshair', null, true);
      if (modifiers.alternate)
        return intent('draw-separate-corridor', 'crosshair', 'separate', true, 'preview');
      if (target === 'compatible-corridor')
        return intent('route-service', 'crosshair', 'connect', true, 'target');
      if (target === 'endpoint')
        return intent('resume-service-and-corridor', 'crosshair', 'extend', true, 'target');
      return intent('draw-service-and-corridor', 'crosshair', 'new', true, 'preview');
    }
    if (input.tool === 'select' && modifiers.alternate && target === 'stop')
      return intent('delete-stop', 'grab', 'erase', true, 'target');
    if (input.tool === 'select' && modifiers.alternate && target === 'facility')
      return intent('delete-facility', 'grab', 'erase', true, 'target');
    if (input.tool === 'select' && target === 'stop')
      return intent('move-stop', 'grab', 'move', true, 'target');
    if (input.tool === 'select' && target === 'facility')
      return intent('move-facility', 'grab', 'move', true, 'target');
    if (input.tool === 'select' && target === 'service-terminus')
      return intent('extend-branch', 'grab', 'extend', true, 'target');
    if (input.tool === 'select' && target === 'line-body')
      return intent('select-line-and-branch', 'default', null, true, 'target');
    return intent(
      input.tool === 'select' ? 'pan' : 'default',
      input.tool === 'select' ? 'grab' : 'crosshair',
      null,
      true,
    );
  }

  if (input.view === 'infrastructure' && input.tool === 'select') {
    const editablePoint = target === 'control-point' || target === 'interior-point';
    if (modifiers.alternate && editablePoint)
      return intent('erase-points', 'grab', 'erase', true, 'target');
    if (modifiers.secondary && target === 'interior-point')
      return intent('split-corridor', 'default', 'split', true, 'target');
    if (modifiers.secondary && target === 'endpoint')
      return intent('extend-corridor', 'grab', 'extend', true, 'target');
    if (editablePoint || target === 'endpoint')
      return modifiers.constrain
        ? intent('constrained-move', 'grab', 'constrain', true, 'target')
        : intent('move-point', 'grab', 'move', true, 'target');
  }

  return intent(
    input.tool === 'select' ? 'pan' : 'default',
    input.tool === 'select' ? 'grab' : 'crosshair',
    null,
    true,
  );
}
