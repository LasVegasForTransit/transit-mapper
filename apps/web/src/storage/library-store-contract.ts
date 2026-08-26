import type { TransitSystem } from '@transitmapper/core/model/system';
import type { LibraryEntry, LoadResult, SaveOutcome } from './localStore';
import type { StoredRecordProvenance } from './stored-record-provenance';

export interface StoredLibraryEntry extends LibraryEntry {
  supersededAuthoritativeSnapshotId?: string;
}

export interface StoredSystemRecord extends StoredLibraryEntry, StoredRecordProvenance {
  serialized: string;
}

export interface LibraryDatabase {
  list(): Promise<StoredLibraryEntry[]>;
  load(id: string): Promise<StoredSystemRecord | null>;
  save(record: StoredSystemRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface LegacyLibrary {
  list(): LibraryEntry[];
  load(id: string): LoadResult;
  saveAuthoritative(system: TransitSystem): SaveOutcome;
  delete(id: string): SaveOutcome;
  getAuthoritativeSnapshotId(id: string): string | null;
  loadLegacySingleSlot(): TransitSystem | null;
  removeLegacySingleSlot(): void;
  isAvailable(): boolean;
  hasDatabaseHistory(): boolean;
  setDatabaseHistory(hasDocuments: boolean): void;
}

export interface LibraryStoreDependencies {
  database: LibraryDatabase;
  legacy: LegacyLibrary;
  serialize: (system: TransitSystem) => Promise<string>;
  deserialize?: (serialized: string) => Promise<TransitSystem>;
}

export type LibraryLoadResult = LoadResult | { status: 'unavailable' };

export type LibraryListResult =
  | {
      status: 'ok';
      entries: LibraryEntry[];
      source: 'complete' | 'legacy-only';
    }
  | { status: 'unavailable' };

export interface LibraryStore {
  list(): Promise<LibraryListResult>;
  load(id: string): Promise<LibraryLoadResult>;
  save(system: TransitSystem): Promise<SaveOutcome>;
  delete(id: string): Promise<SaveOutcome>;
  migrateLegacySingleSlot(): Promise<TransitSystem | null>;
}
