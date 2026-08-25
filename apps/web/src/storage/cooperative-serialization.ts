import type { TransitSystem } from '@transitmapper/core/model/system';

const DEFAULT_SLICE_MS = 5;

export const STORAGE_SERIALIZATION_START_MARK = 'transitmapper:storage-serialization-start';
export const STORAGE_SERIALIZATION_END_MARK = 'transitmapper:storage-serialization-end';

interface BrowserScheduler {
  yield?: () => Promise<void>;
}

export interface CooperativeSerializationOptions {
  readonly sliceMs?: number;
  readonly now?: () => number;
  readonly yieldControl?: () => Promise<void>;
}

function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as unknown as { scheduler?: BrowserScheduler }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function encodeJson(value: unknown): string | undefined {
  // TypeScript's library declaration omits the real `undefined` result for
  // unsupported values. Native JSON semantics still omit object properties
  // and substitute null inside arrays.
  return JSON.stringify(value);
}

function encodedArrayItem(value: unknown): string {
  return encodeJson(value) ?? 'null';
}

function mark(name: string): void {
  try {
    globalThis.performance.mark(name);
  } catch {
    // User Timing diagnostics cannot make a document unsavable.
  }
}

async function encodeArray(
  values: readonly unknown[],
  yieldIfNeeded: () => Promise<void>,
): Promise<string> {
  const parts = ['['];
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) parts.push(',');
    parts.push(encodedArrayItem(values[index]));
    await yieldIfNeeded();
  }
  parts.push(']');
  return parts.join('');
}

/** Serializes the immutable document without one city-scale structured clone
 * or one unbroken `JSON.stringify` task. Top-level entity collections are
 * emitted item by item, and the serializer yields whenever its current CPU
 * slice expires. */
async function serializeSystemParts(
  system: TransitSystem,
  options: CooperativeSerializationOptions = {},
): Promise<string> {
  const now = options.now ?? (() => performance.now());
  const yieldControl = options.yieldControl ?? yieldToBrowser;
  const sliceMs = options.sliceMs ?? DEFAULT_SLICE_MS;
  const parts: string[] = ['{'];
  let firstProperty = true;
  let sliceStartedAt = now();

  const yieldIfNeeded = async () => {
    if (now() - sliceStartedAt < sliceMs) return;
    await yieldControl();
    sliceStartedAt = now();
  };

  for (const [key, value] of Object.entries(system)) {
    const encoded = Array.isArray(value)
      ? await encodeArray(value, yieldIfNeeded)
      : encodeJson(value);
    if (encoded === undefined) continue;
    parts.push(firstProperty ? '' : ',', JSON.stringify(key), ':', encoded);
    firstProperty = false;
    await yieldIfNeeded();
  }
  parts.push('}');
  return parts.join('');
}

export async function serializeSystemCooperatively(
  system: TransitSystem,
  options: CooperativeSerializationOptions = {},
): Promise<string> {
  mark(STORAGE_SERIALIZATION_START_MARK);
  try {
    return await serializeSystemParts(system, options);
  } finally {
    mark(STORAGE_SERIALIZATION_END_MARK);
  }
}
