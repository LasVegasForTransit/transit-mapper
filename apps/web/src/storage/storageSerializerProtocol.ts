import type { TransitSystem } from '@transitmapper/core/model/system';

export interface StorageSerializerRequest {
  system: TransitSystem;
}

export interface StorageSerializerSuccess {
  kind: 'done';
  serialized: string;
}

export interface StorageSerializerFailure {
  kind: 'error';
  message: string;
}

export type StorageSerializerEvent = StorageSerializerSuccess | StorageSerializerFailure;
