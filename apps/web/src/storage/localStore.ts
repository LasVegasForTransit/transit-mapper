import { parseSystem } from "@transitmapper/core/model/serialize";
import type { TransitSystem } from "@transitmapper/core/model/system";

// A real library of saved systems, replacing the old single-slot autosave
// (one system ever, "New system" silently overwrote it). Each system gets
// its own key so switching between them never touches the others; a small
// index holds just enough (id/name/updatedAt) to render a list without
// loading every full system.
const LEGACY_KEY = "transitmapper:system"; // pre-library single slot
const LIBRARY_INDEX_KEY = "transitmapper:library";
const ACTIVE_ID_KEY = "transitmapper:activeId";
const SYSTEM_KEY_PREFIX = "transitmapper:system:";
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
        const stored = JSON.parse(localStorage.getItem(key) ?? "");
        found.push({
          id,
          name: typeof stored?.name === "string" ? stored.name : "Recovered system",
          updatedAt: typeof stored?.updatedAt === "number" ? stored.updatedAt : 0,
        });
      } catch {
        // Unparseable, but still real and still taking up space. Listing it
        // is what makes it deletable; loadSystemEntry reports it as corrupt.
        found.push({ id, name: "Damaged system", updatedAt: 0 });
      }
    }
  } catch {
    return found;
  }
  return found;
}

function readIndex(): LibraryEntry[] {
  let entries: LibraryEntry[] = [];
  try {
    const raw = localStorage.getItem(LIBRARY_INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      entries = parsed.filter(
        (e): e is LibraryEntry => !!e && typeof e.id === "string" && typeof e.name === "string" && typeof e.updatedAt === "number",
      );
    }
  } catch {
    entries = [];
  }
  return [...entries, ...orphanedEntries(new Set(entries.map((e) => e.id)))];
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
export type SaveOutcome = "saved" | "full" | "unavailable";

/** Quota exhaustion reports differently across browsers, and pre-DOMException
 *  Firefox used its own name — check every spelling rather than assume. */
function outcomeFor(error: unknown): SaveOutcome {
  const name = error instanceof Error ? error.name : "";
  const code = error instanceof DOMException ? error.code : 0;
  const quota = name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
  return quota ? "full" : "unavailable";
}

function writeIndex(entries: LibraryEntry[]): SaveOutcome {
  try {
    localStorage.setItem(LIBRARY_INDEX_KEY, JSON.stringify(entries));
    return "saved";
  } catch (e) {
    return outcomeFor(e);
  }
}

/** Every saved system, most recently updated first. */
export function listLibrary(): LibraryEntry[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
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
  | { status: "ok"; system: TransitSystem }
  | { status: "missing" }
  | { status: "corrupt" };

export function loadSystemEntry(id: string): LoadResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(systemKey(id));
  } catch {
    return { status: "missing" }; // storage unreadable — nothing to distinguish.
  }
  if (!raw) return { status: "missing" };
  try {
    return { status: "ok", system: parseSystem(JSON.parse(raw)) };
  } catch {
    // The bytes are still sitting under this key. Nothing here deletes them —
    // a future version that can repair them should still find them.
    return { status: "corrupt" };
  }
}

/** Thin wrapper for callers that genuinely can't act on the difference. */
export function loadSystemById(id: string): TransitSystem | null {
  const result = loadSystemEntry(id);
  return result.status === "ok" ? result.system : null;
}

/** Saves the full system AND keeps its index entry (name/updatedAt) in sync
 *  — callers never touch the index directly.
 *
 *  Returns whether the system is actually on disk. A `saved` here is the only
 *  evidence the work survives a reload; see `SaveOutcome` for why that is
 *  reported rather than swallowed. The index write is reported too: a system
 *  stored under a key no index entry points at is invisible in "My systems"
 *  and consumes quota forever, which is its own kind of loss. */
export function saveToLibrary(system: TransitSystem): SaveOutcome {
  try {
    localStorage.setItem(systemKey(system.id), JSON.stringify(system));
  } catch (e) {
    return outcomeFor(e);
  }
  return writeIndex([...readIndex().filter((e) => e.id !== system.id), { id: system.id, name: system.name, updatedAt: system.updatedAt }]);
}

export function deleteFromLibrary(id: string): void {
  try {
    localStorage.removeItem(systemKey(id));
  } catch {
    // ignore
  }
  writeIndex(readIndex().filter((e) => e.id !== id));
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

/** One-time migration from the pre-library single autosave slot — loads it,
 *  saves it into the library under its own id, and removes the legacy key.
 *  Returns null (a no-op) if there was nothing there to migrate. */
export function migrateLegacySingleSlot(): TransitSystem | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const system = parseSystem(JSON.parse(raw));
    // Only drop the legacy key once the copy is definitely on disk. Removing
    // it after a failed save would delete the one surviving copy of work that
    // predates the library — the exact data this migration exists to rescue.
    if (saveToLibrary(system) !== "saved") return system;
    localStorage.removeItem(LEGACY_KEY);
    return system;
  } catch {
    return null;
  }
}
