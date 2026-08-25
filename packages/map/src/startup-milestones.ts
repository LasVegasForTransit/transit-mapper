export interface MapStartupMilestones {
  contentCommitted(): void;
  interactive(): void;
}

export interface MapStartupMilestoneSnapshot {
  contentCommitted: boolean;
  interactive: boolean;
}

export interface MapStartupMilestoneObservers {
  onContentCommitted?: () => void;
  onInteractive?: () => void;
}

export interface ObservableMapStartupMilestones extends MapStartupMilestones {
  getSnapshot(): MapStartupMilestoneSnapshot;
  subscribe(listener: (snapshot: MapStartupMilestoneSnapshot) => void): () => void;
}

function snapshot(contentCommitted: boolean, interactive: boolean) {
  return Object.freeze({ contentCommitted, interactive });
}

export function createMapStartupMilestones(
  observers: MapStartupMilestoneObservers = {},
): ObservableMapStartupMilestones {
  let current = snapshot(false, false);
  const listeners = new Set<(snapshot: MapStartupMilestoneSnapshot) => void>();

  const publish = (next: MapStartupMilestoneSnapshot) => {
    current = next;
    for (const listener of listeners) listener(current);
  };

  const contentCommitted = () => {
    if (current.contentCommitted) return;
    publish(snapshot(true, false));
    observers.onContentCommitted?.();
  };

  const interactive = () => {
    if (current.interactive) return;
    contentCommitted();
    publish(snapshot(true, true));
    observers.onInteractive?.();
  };

  return {
    contentCommitted,
    interactive,
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
