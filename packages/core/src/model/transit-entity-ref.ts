export type TransitEntityRef =
  | { kind: 'publisher'; id: string }
  | { kind: 'agency'; id: string }
  | { kind: 'operator'; id: string }
  | { kind: 'alignment'; id: string }
  | { kind: 'way'; id: string }
  | { kind: 'line'; id: string }
  | { kind: 'service-plan'; id: string }
  | { kind: 'pattern'; id: string }
  | { kind: 'schedule'; id: string }
  | { kind: 'calendar'; id: string }
  | { kind: 'trip'; id: string }
  | { kind: 'frequency-rule'; id: string }
  | { kind: 'operational-change'; id: string }
  | { kind: 'advisory'; id: string }
  | { kind: 'stop'; id: string }
  | { kind: 'station'; id: string }
  | { kind: 'facility'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'named-way'; id: string }
  | { kind: 'median'; id: string }
  | { kind: 'lane-connector'; id: string }
  | { kind: 'turn-restriction'; id: string }
  | { kind: 'approach-control'; id: string };

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
