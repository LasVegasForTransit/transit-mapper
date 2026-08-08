import type { TransitSystem } from '@transitmapper/core/model/system';

export interface StorageSerializerRequest {
  system: TransitSystem;
}

interface StorageSerializerSuccess {
  kind: 'done';
  serialized: string;
}

interface StorageSerializerFailure {
  kind: 'error';
  message: string;
}

export type StorageSerializerEvent = StorageSerializerSuccess | StorageSerializerFailure;
