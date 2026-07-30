import { parseSystem } from '@transitmapper/core/model/serialize';
import { shortId } from '@transitmapper/core/model/ids';
import type { TransitSystem } from '@transitmapper/core/model/system';

// A real library of saved systems, replacing the old single-slot autosave
// (one system ever, "New system" silently overwrote it). Each system gets
// its own key so switching between them never touches the others; a small
// index holds just enough (id/name/updatedAt) to render a list without
// loading every full system.
const LEGACY_KEY = 'transitmapper:system'; // pre-library single slot
const LIBRARY_INDEX_KEY = 'transitmapper:library';
const ACTIVE_ID_KEY = 'transitmapper:activeId';
const ONBOARDING_SEEN_KEY = 'transitmapper:onboardingSeen';
const INDEXED_DB_HISTORY_KEY = 'transitmapper:indexedDbLibrary';
const STORAGE_PROBE_KEY = 'transitmapper:storageProbe';
const SYSTEM_KEY_PREFIX = 'transitmapper:system:';
const EMERGENCY_SNAPSHOT_FIELD = '__transitmapperEmergencySnapshot';
const LEGACY_AUTHORITATIVE_SNAPSHOT_ID = 'legacy-emergency-snapshot';
const systemKey = (id: string) => `${SYSTEM_KEY_PREFIX}${id}`;

export interface LibraryEntry {
  id: string;
  name: string;
  updatedAt: number;
}

/**
 * Systems present in storage that the index doesn't mention.
 *
 * A save writes the system and then the index, so a failure between the two
 * (quota, most likely) leaves bytes under a key nothing points at. Deleting
 * them would be the obvious repair and the wrong one: for the system the user
 * currently has open, `activeId` still points at that key, so the work is
 * intact and reachable on the next load — deleting it would destroy the one
 * thing this module exists to protect.
 *
 * So the index heals toward storage rather than storage being trimmed to
 * match the index. An orphan reappears in the library, where it can be opened
 * or deleted deliberately, instead of sitting invisible and consuming the
 * quota the user is being told to free.
 */
function orphanedEntries(known: Set<string>): LibraryEntry[] {
  const found: LibraryEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      // LEGACY_KEY has no trailing colon, so it can't match this prefix.
      if (!key || !key.startsWith(SYSTEM_KEY_PREFIX)) continue;
      const id = key.slice(SYSTEM_KEY_PREFIX.length);
      if (known.has(id)) continue;
      // Only orphans are parsed — the normal path never pays for this.
      try {
        const stored = JSON.parse(localStorage.getItem(key) ?? '');
        found.push({
          id,
          name: typeof stored?.name === 'string' ? stored.name : 'Recovered system',
          updatedAt: typeof stored?.updatedAt === 'number' ? stored.updatedAt : 0,
        });
      } catch {
        // Unparseable, but still real and still taking up space. Listing it
        // is what makes it deletable; loadSystemEntry reports it as corrupt.
        found.push({ id, name: 'Damaged system', updatedAt: 0 });
      }
    }
  } catch {
    return found;
  }
  return found;
}

/**
 * The index as stored. Deliberately does NOT reconcile against storage —
 * `saveToLibrary` calls this on every autosave, and scanning every
 * localStorage key (and parsing any orphan found) is not something to put on
 * the path that runs after every edit. Recovery belongs where a human is
 * looking; see listLibrary.
 */
function readIndex(): LibraryEntry[] {
  try {
    const raw = localStorage.getItem(LIBRARY_INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is LibraryEntry =>
        !!e &&
        typeof e.id === 'string' &&
        typeof e.name === 'string' &&
        typeof e.updatedAt === 'number',
    );
  } catch {
    return [];
  }
}

/**
 * Why a save reports back instead of failing quietly.
 *
 * Autosave is the only thing standing between a person's afternoon and
 * nothing. When `localStorage.setItem` throws — the quota is ~5MB and a
 * GTFS-imported system is several — every subsequent save is a no-op, and the
 * editor carries on looking perfectly healthy because the working copy lives
 * in memory. The user finds out at the next reload, when the work is already
 * gone. Swallowing that exception is the difference between "the browser is
 * full" (recoverable: delete a system, export to a file) and "your afternoon
 * is gone" (not recoverable at all), so every writing path returns an outcome
 * and `App` puts a failure on screen.
 *
 * `full` and `unavailable` are separated because the remedy differs: one is
 * "make room", the other is "this browser will not persist anything" (private
 * browsing, storage disabled) and no amount of deleting helps.
 */
export type SaveOutcome = 'saved' | 'full' | 'unavailable';

export interface SaveMeasurement {
  documentBytes: number;
  serializeMs: number;
  documentWriteMs: number;
  indexWriteMs: number;
  outcome: SaveOutcome;
}

export interface SaveToLibraryOptions {
  onMeasure?: (measurement: SaveMeasurement) => void;
  /** Deterministic clock seam for tests; performance.now in real measurements. */
  now?: () => number;
  /** Keep recovery authority in the same atomic document write. */
  authoritativeSnapshotId?: string;
}

/** Quota exhaustion reports differently across browsers, and pre-DOMException
 *  Firefox used its own name — check every spelling rather than assume. */
function outcomeFor(error: unknown): SaveOutcome {
  const name = error instanceof Error ? error.name : '';
  const code = error instanceof DOMException ? error.code : 0;
  const quota =
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014;
  return quota ? 'full' : 'unavailable';
}

function writeIndex(entries: LibraryEntry[]): SaveOutcome {
  try {
    localStorage.setItem(LIBRARY_INDEX_KEY, JSON.stringify(entries));
    return 'saved';
  } catch (e) {
    return outcomeFor(e);
  }
}

/**
 * Every saved system, most recently updated first — including any the index
 * has lost track of.
 *
 * Reconciliation happens here rather than in readIndex because this is the
 * one caller a person is waiting on (the "My systems" dialog), while
 * readIndex runs on every autosave. An orphan is worth a full scan when
 * someone is looking at the list, and not worth it 400ms after every edit.
 */
export function listLibrary(): LibraryEntry[] {
  const entries = readIndex();
  const recovered = orphanedEntries(new Set(entries.map((e) => e.id)));
  return [...entries, ...recovered].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * A stored system, or why there isn't one. `missing` and `corrupt` look the
 * same to a caller that only checks for null, and they are not the same thing
 * at all: "you have no saved systems" is a normal first run, while "the system
 * you were working on will not parse" is the user's work failing to come back
 * and the one case worth saying out loud. Bootstrapping distinguishes them so
 * a damaged record produces an explanation instead of a silent blank canvas.
 */
export type LoadResult =
  { status: 'ok'; system: TransitSystem } | { status: 'missing' } | { status: 'corrupt' };

export function loadSystemEntry(id: string): LoadResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(systemKey(id));
  } catch {
    return { status: 'missing' }; // storage unreadable — nothing to distinguish.
  }
  if (!raw) return { status: 'missing' };
  try {
    return { status: 'ok', system: parseSystem(JSON.parse(raw)) };
  } catch {
    // The bytes are still sitting under this key. Nothing here deletes them —
    // a future version that can repair them should still find them.
    return { status: 'corrupt' };
  }
}

/** Thin wrapper for callers that genuinely can't act on the difference. */
export function loadSystemById(id: string): TransitSystem | null {
  const result = loadSystemEntry(id);
  return result.status === 'ok' ? result.system : null;
}

/** Saves the full system AND keeps its index entry (name/updatedAt) in sync
 *  — callers never touch the index directly.
 *
 *  Returns whether the system is actually on disk. A `saved` here is the only
 *  evidence the work survives a reload; see `SaveOutcome` for why that is
 *  reported rather than swallowed. The index write is reported too: a system
 *  stored under a key no index entry points at is invisible in "My systems"
 *  and consumes quota forever, which is its own kind of loss. */
export function saveToLibrary(
  system: TransitSystem,
  options: SaveToLibraryOptions = {},
): SaveOutcome {
  const measuring = options.onMeasure !== undefined;
  const now = options.now ?? (() => performance.now());
  const startedAt = measuring ? now() : 0;
  let serialized = '';
  let serializedAt = startedAt;
  let documentWrittenAt = startedAt;
  try {
    // A camera-only save deliberately keeps updatedAt unchanged. The marker
    // therefore travels in the same localStorage value as the document: a
    // separate metadata write could be lost at termination or quota limits,
    // making an older IndexedDB record look equally current on the next load.
    serialized = JSON.stringify(
      options.authoritativeSnapshotId
        ? { ...system, [EMERGENCY_SNAPSHOT_FIELD]: options.authoritativeSnapshotId }
        : system,
    );
    serializedAt = measuring ? now() : 0;
    localStorage.setItem(systemKey(system.id), serialized);
    documentWrittenAt = measuring ? now() : 0;
  } catch (e) {
    const outcome = outcomeFor(e);
    options.onMeasure?.({
      documentBytes: serialized ? new TextEncoder().encode(serialized).byteLength : 0,
      serializeMs: Math.max(0, serializedAt - startedAt),
      documentWriteMs: Math.max(0, documentWrittenAt - serializedAt),
      indexWriteMs: 0,
      outcome,
    });
    return outcome;
  }
  const outcome = writeIndex([
    ...readIndex().filter((e) => e.id !== system.id),
    { id: system.id, name: system.name, updatedAt: system.updatedAt },
  ]);
  const completedAt = measuring ? now() : 0;
  options.onMeasure?.({
    documentBytes: new TextEncoder().encode(serialized).byteLength,
    serializeMs: serializedAt - startedAt,
    documentWriteMs: documentWrittenAt - serializedAt,
    indexWriteMs: completedAt - documentWrittenAt,
    outcome,
  });
  return outcome;
}

/** A synchronous recovery copy used when IndexedDB cannot commit. Its unique
 * marker lets a later IndexedDB record prove exactly which fallback it
 * superseded, even when undo moved the document timestamp backward. */
export function saveAuthoritativeToLibrary(system: TransitSystem): SaveOutcome {
  return saveToLibrary(system, { authoritativeSnapshotId: shortId(16) });
}

export function getAuthoritativeSnapshotId(id: string): string | null {
  try {
    const raw = localStorage.getItem(systemKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const marker = parsed[EMERGENCY_SNAPSHOT_FIELD];
    if (typeof marker === 'string' && marker.length > 0) return marker;
    // Read the boolean marker written by early performance-audit builds.
    return marker === true ? LEGACY_AUTHORITATIVE_SNAPSHOT_ID : null;
  } catch {
    return null;
  }
}

/** Synchronous close-time recovery uses the same authoritative copy format as
 * an IndexedDB-failure fallback. */
export const saveEmergencyToLibrary = saveAuthoritativeToLibrary;

/** Compatibility predicate for tests and callers that only need presence. */
export function isEmergencyLibraryCopy(id: string): boolean {
  return getAuthoritativeSnapshotId(id) !== null;
}

/**
 * Removes the system, then its index entry — in that order, and only if the
 * first succeeded.
 *
 * The order matters now that listLibrary recovers orphans. Dropping the index
 * entry while the bytes survive would make the row reappear on the next
 * listing, so a delete that failed would look like a delete that undid
 * itself. Keeping the two consistent means a failure leaves the row exactly
 * as it was, which is at least honest.
 */
export function deleteFromLibrary(id: string): SaveOutcome {
  try {
    localStorage.removeItem(systemKey(id));
  } catch (e) {
    return outcomeFor(e);
  }
  return writeIndex(readIndex().filter((e) => e.id !== id));
}

export function getActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_ID_KEY);
  } catch {
    return null;
  }
}

export function setActiveId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_ID_KEY, id);
  } catch {
    // ignore
  }
}

/** A read can succeed in browser modes that reject every write. Bootstrap
 * uses this probe only when IndexedDB is unavailable and no local documents
 * exist, to decide whether a genuinely new localStorage-only library is
 * viable without confusing a failed IndexedDB read with an empty library. */
export function isLocalStorageAvailable(): boolean {
  try {
    localStorage.setItem(STORAGE_PROBE_KEY, '1');
    localStorage.removeItem(STORAGE_PROBE_KEY);
    return true;
  } catch {
    try {
      localStorage.removeItem(STORAGE_PROBE_KEY);
    } catch {
      // Storage is unavailable; cleanup cannot improve that result.
    }
    return false;
  }
}

export function hasIndexedDbLibraryHistory(): boolean {
  try {
    return localStorage.getItem(INDEXED_DB_HISTORY_KEY) === '1';
  } catch {
    return false;
  }
}

export function setIndexedDbLibraryHistory(hasDocuments: boolean): void {
  try {
    if (hasDocuments) localStorage.setItem(INDEXED_DB_HISTORY_KEY, '1');
    else localStorage.removeItem(INDEXED_DB_HISTORY_KEY);
  } catch {
    // The active-id pointer still protects the common migrated-document
    // recovery path when this small advisory marker cannot be written.
  }
}

/** Whether this browser has completed onboarding before. Closing the dialog
 *  does not set this flag: only its final action does. A storage failure reads
 *  as incomplete so onboarding shows again rather than silently disappearing. */
export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
  } catch {
    // ignore — worst case onboarding shows again next launch
  }
}

/** Reads the pre-library single autosave without modifying it. The async
 * IndexedDB migration removes this key only after its replacement commits. */
export function loadLegacySingleSlot(): TransitSystem | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? parseSystem(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function removeLegacySingleSlot(): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // The committed library copy is durable. Leaving this redundant source
    // costs space but is safer than treating cleanup as a failed migration.
  }
}

/** One-time migration from the pre-library single autosave slot — loads it,
 *  saves it into the library under its own id, and removes the legacy key.
 *  Returns null (a no-op) if there was nothing there to migrate. */
export function migrateLegacySingleSlot(): TransitSystem | null {
  const system = loadLegacySingleSlot();
  if (!system) return null;
  // Only drop the legacy key once the copy is definitely on disk. Removing
  // it after a failed save would delete the one surviving copy of work that
  // predates the library — the exact data this migration exists to rescue.
  if (saveToLibrary(system) === 'saved') removeLegacySingleSlot();
  return system;
}
