interface NativeGestureHandler {
  isEnabled(): boolean;
  disable(): void;
  enable(): void;
}

export interface EditorMapNavigationHost {
  readonly dragPan: NativeGestureHandler;
  readonly dragRotate: NativeGestureHandler;
  readonly doubleClickZoom: NativeGestureHandler;
  readonly keyboard: NativeGestureHandler;
  readonly boxZoom: NativeGestureHandler;
}

/** The bare runtime owns navigation until the editor's tool controller is
 * ready. Capture the exact native state before claiming those gestures so a
 * failed or replaced attachment can hand the same runtime back intact. */
export function claimEditorMapNavigation(host: EditorMapNavigationHost): () => void {
  const handlers = [
    host.dragPan,
    host.dragRotate,
    host.doubleClickZoom,
    host.keyboard,
    host.boxZoom,
  ];
  const previouslyEnabled = handlers.map((handler) => handler.isEnabled());
  for (const handler of handlers) handler.disable();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    handlers.forEach((handler, index) => {
      if (previouslyEnabled[index]) handler.enable();
    });
  };
}
