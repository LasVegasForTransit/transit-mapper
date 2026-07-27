// Local record of shares this browser created, keyed by the document's own
// (stable) id rather than the share id — so re-sharing the same document
// finds its existing share regardless of what content it currently holds.
//
// This IS the "device recognition" for the share-editing feature: there is
// no server-side account or identity, only "does this browser still have the
// edit token it was handed at creation." Losing this (private mode, cleared
// site data) just means the next share re-creates or re-dedups rather than
// updating in place — never data loss, since the share itself is unaffected.
const STORAGE_KEY = "transitmapper:myShares";

export interface MyShareEntry {
  documentId: string;
  shareId: string;
  editToken: string;
  /** The exact JSON last sent to the server, so "has this changed since I
   *  last shared it" is a plain string comparison — no hashing needed here,
   *  the server does its own hashing independently for dedup. */
  lastSharedData: string;
  updatedAt: number;
}

function isMyShareEntry(v: unknown): v is MyShareEntry {
  const r = v as Record<string, unknown>;
  return (
    !!r &&
    typeof r.documentId === "string" &&
    typeof r.shareId === "string" &&
    typeof r.editToken === "string" &&
    typeof r.lastSharedData === "string" &&
    typeof r.updatedAt === "number"
  );
}

function readAll(): MyShareEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isMyShareEntry) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: MyShareEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Best-effort cache, not the system of record for the share itself — if
    // this write fails (quota, private mode) the share still exists, the
    // next open just won't recognize it as this device's.
  }
}

export function getMyShare(documentId: string): MyShareEntry | null {
  return readAll().find((e) => e.documentId === documentId) ?? null;
}

export function setMyShare(entry: MyShareEntry): void {
  writeAll([...readAll().filter((e) => e.documentId !== entry.documentId), entry]);
}

export function removeMyShare(documentId: string): void {
  writeAll(readAll().filter((e) => e.documentId !== documentId));
}
