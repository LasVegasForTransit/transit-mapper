import type { TransitSystem } from '@transitmapper/core/model/system';

export const CURRENT_STORED_SYSTEM_FORMAT = 'transitmapper-system-v16';

export interface StoredRecordProvenance {
  format?: string;
  contentDigest?: string;
}

interface StoredRecordEnvelope extends StoredRecordProvenance {
  id: string;
  name: string;
  updatedAt: number;
  serialized: string;
}

const COLLECTION_KEYS = [
  'ways',
  'lines',
  'services',
  'stops',
  'stations',
  'facilities',
  'groups',
  'nodes',
  'namedWays',
  'vehicleKinds',
  'palette',
] as const;

function currentSystemEnvelope(
  value: unknown,
  record: StoredRecordEnvelope,
): value is TransitSystem {
  if (!value || typeof value !== 'object') return false;
  const system = value as Record<string, unknown>;
  if (
    system.version !== 16 ||
    system.id !== record.id ||
    system.name !== record.name ||
    system.updatedAt !== record.updatedAt ||
    !system.viewport ||
    typeof system.viewport !== 'object'
  ) {
    return false;
  }
  if (!COLLECTION_KEYS.every((key) => Array.isArray(system[key]))) return false;
  return (
    typeof system.turnRestrictions === 'object' &&
    system.turnRestrictions !== null &&
    typeof system.medians === 'object' &&
    system.medians !== null &&
    typeof system.approachControls === 'object' &&
    system.approachControls !== null
  );
}

async function sha256(serialized: string): Promise<string | null> {
  try {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(serialized),
    );
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    // Provenance accelerates a load. It must never make a document unsavable
    // in a browser that exposes Web Crypto but rejects this operation.
    return null;
  }
}

/** Mark bytes produced from the live editor model. The digest detects stale
 * or damaged bytes; it is not an authentication boundary for local storage. */
export async function provenanceForSerializedSystem(
  serialized: string,
): Promise<StoredRecordProvenance> {
  const contentDigest = await sha256(serialized);
  return contentDigest ? { format: CURRENT_STORED_SYSTEM_FORMAT, contentDigest } : {};
}

/** Read the exact current model that this application saved without rebuilding
 * its complete coordinate graph. Older, changed, or incomplete records return
 * null so the migration and validation parser remains authoritative for them. */
export async function readCurrentAppSave(
  record: StoredRecordEnvelope,
): Promise<TransitSystem | null> {
  if (record.format !== CURRENT_STORED_SYSTEM_FORMAT || typeof record.contentDigest !== 'string') {
    return null;
  }
  const contentDigest = await sha256(record.serialized);
  if (contentDigest === null || contentDigest !== record.contentDigest) return null;
  try {
    const value = JSON.parse(record.serialized) as unknown;
    return currentSystemEnvelope(value, record) ? value : null;
  } catch {
    return null;
  }
}
