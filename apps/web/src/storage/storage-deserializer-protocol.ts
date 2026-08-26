export interface StorageDeserializerRequest {
  serialized: string;
}

export type StorageDeserializerEvent =
  { kind: 'done'; serialized: string } | { kind: 'error'; message: string };
