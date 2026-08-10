import type { TransitSystem } from '@transitmapper/core/model/system';

export interface StorageDeserializerRequest {
  serialized: string;
}

export type StorageDeserializerEvent =
  { kind: 'done'; system: TransitSystem } | { kind: 'error'; message: string };
