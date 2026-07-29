export type PerfListenerTarget = 'window' | 'document' | 'map-canvas';

export interface PerfListenerLocation {
  scriptUrl?: string;
  scriptId?: string;
  lineNumber: number;
  columnNumber: number;
}

export interface PerfListenerDescription {
  type: string;
  useCapture: boolean;
  passive: boolean;
  once: boolean;
  backendNodeId?: number;
  scriptId?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface PerfListenerIdentity {
  target: PerfListenerTarget;
  backendNodeId?: number;
  type: string;
  useCapture: boolean;
  passive: boolean;
  once: boolean;
  location?: PerfListenerLocation;
}

export interface PerfListenerGroup extends PerfListenerIdentity {
  count: number;
}

export interface PerfListenerDelta extends PerfListenerIdentity {
  initialCount: number;
  finalCount: number;
  delta: number;
}

export interface PerfListenerDiagnostics {
  initial: PerfListenerGroup[];
  final: PerfListenerGroup[];
  deltas: PerfListenerDelta[];
}

function listenerLocation(
  listener: PerfListenerDescription,
  scriptUrl?: string,
): PerfListenerLocation | undefined {
  const { lineNumber, columnNumber } = listener;
  if (lineNumber === undefined || columnNumber === undefined) return undefined;
  if (scriptUrl) return { scriptUrl, lineNumber, columnNumber };
  if (listener.scriptId) return { scriptId: listener.scriptId, lineNumber, columnNumber };
  return { lineNumber, columnNumber };
}

export function createPerfListenerIdentity(
  target: PerfListenerTarget,
  listener: PerfListenerDescription,
  scriptUrl?: string,
): PerfListenerIdentity {
  const location = listenerLocation(listener, scriptUrl);
  return {
    target,
    ...(listener.backendNodeId === undefined ? {} : { backendNodeId: listener.backendNodeId }),
    type: listener.type,
    useCapture: listener.useCapture,
    passive: listener.passive,
    once: listener.once,
    ...(location ? { location } : {}),
  };
}

function normalizeListener(listener: PerfListenerIdentity): PerfListenerIdentity {
  if (!listener.location?.scriptUrl || !listener.location.scriptId) return listener;
  const { scriptId: _, ...stableLocation } = listener.location;
  return { ...listener, location: stableLocation };
}

function listenerKey(listener: PerfListenerIdentity): string {
  return JSON.stringify([
    listener.target,
    listener.type,
    listener.useCapture,
    listener.passive,
    listener.once,
    listener.backendNodeId ?? null,
    listener.location?.scriptUrl ?? null,
    listener.location?.scriptUrl ? null : (listener.location?.scriptId ?? null),
    listener.location?.lineNumber ?? null,
    listener.location?.columnNumber ?? null,
  ]);
}

export function groupListenerInventory(listeners: PerfListenerIdentity[]): PerfListenerGroup[] {
  const groups = new Map<string, PerfListenerGroup>();
  for (const listener of listeners) {
    const normalized = normalizeListener(listener);
    const key = listenerKey(normalized);
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { ...normalized, count: 1 });
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, listener]) => listener);
}

export function listenerDeltas(
  initial: PerfListenerGroup[],
  final: PerfListenerGroup[],
): PerfListenerDelta[] {
  const initialByKey = new Map(
    initial.map((listener) => [listenerKey(listener), listener] as const),
  );
  const finalByKey = new Map(final.map((listener) => [listenerKey(listener), listener] as const));
  const keys = new Set([...initialByKey.keys(), ...finalByKey.keys()]);
  return [...keys].sort().flatMap((key) => {
    const initialListener = initialByKey.get(key);
    const finalListener = finalByKey.get(key);
    const initialCount = initialListener?.count ?? 0;
    const finalCount = finalListener?.count ?? 0;
    const delta = finalCount - initialCount;
    if (delta === 0) return [];
    const source = finalListener ?? initialListener;
    if (!source) return [];
    const { count: _, ...identity } = source;
    return [{ ...identity, initialCount, finalCount, delta }];
  });
}
