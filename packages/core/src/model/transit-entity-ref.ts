import type { TransitEntityRef } from '../transit/entity-ref';

export type { TransitEntityRef } from '../transit/entity-ref';

declare const transitEntityKeyBrand: unique symbol;

export type TransitEntityKey = string & {
  readonly [transitEntityKeyBrand]: 'TransitEntityKey';
};

function encodedComponent(value: string): string {
  return encodeURIComponent(value);
}

export function transitEntityKey(reference: TransitEntityRef): TransitEntityKey {
  if (reference.id.trim().length === 0) {
    throw new Error('Transit entity ID must not be empty.');
  }

  return `domain:${encodedComponent(reference.kind)}:${encodedComponent(reference.id)}` as TransitEntityKey;
}
