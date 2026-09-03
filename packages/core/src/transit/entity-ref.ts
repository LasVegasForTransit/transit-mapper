/** A portable core reference to a transit record. Compatibility aliases are not entities. */
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
