export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

const maximumUnsigned32 = 0xffff_ffff;
const textEncoder = new TextEncoder();

/**
 * One scratch view for every number this module writes.
 *
 * `new DataView` per value was the encoder's whole cost. A document with
 * 121,000 coordinates writes a quarter of a million floats and as many length
 * prefixes, and allocating a view for each dominated the hashing it feeds by
 * two orders of magnitude. The scratch is written and copied out before any
 * other code runs, so nothing can observe it between the two.
 */
const scratchBytes = new Uint8Array(8);
const scratchView = new DataView(scratchBytes.buffer);

function requireUnsigned32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximumUnsigned32) {
    throw new Error(`${label} exceeds the canonical unsigned 32-bit limit.`);
  }
}

function unsigned32Bytes(value: number, label: string): Uint8Array {
  requireUnsigned32(value, label);
  const bytes = new Uint8Array(4);
  scratchView.setUint32(0, value, false);
  bytes[0] = scratchBytes[0];
  bytes[1] = scratchBytes[1];
  bytes[2] = scratchBytes[2];
  bytes[3] = scratchBytes[3];
  return bytes;
}

function writeUnsigned32(target: Uint8Array, offset: number, value: number, label: string): number {
  requireUnsigned32(value, label);
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
  return offset + 4;
}

function append(target: Uint8Array, offset: number, value: Uint8Array): number {
  target.set(value, offset);
  return offset + value.length;
}

function encodedTotal(parts: readonly Uint8Array[], fixedLength: number): number {
  let total = fixedLength;
  for (const part of parts) {
    total += part.length;
    if (!Number.isSafeInteger(total) || total > maximumUnsigned32) {
      throw new Error('Canonical value bytes exceed the unsigned 32-bit limit.');
    }
  }
  return total;
}

function utf8Bytes(value: string, label: string): Uint8Array {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw new Error(`${label} contains an unpaired surrogate.`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error(`${label} contains an unpaired surrogate.`);
    }
  }
  const bytes = textEncoder.encode(value);
  requireUnsigned32(bytes.length, `${label} byte length`);
  return bytes;
}

function compareUnsignedBytes(left: Uint8Array, right: Uint8Array): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function encodeNumber(value: number): Uint8Array {
  if (!Number.isFinite(value)) {
    throw new Error('Canonical numbers must be finite.');
  }
  const bytes = new Uint8Array(9);
  bytes[0] = 0x03;
  scratchView.setFloat64(0, Object.is(value, -0) ? 0 : value, false);
  bytes.set(scratchBytes, 1);
  return bytes;
}

function encodeString(value: string, label: string): Uint8Array {
  const text = utf8Bytes(value, label);
  const bytes = new Uint8Array(5 + text.length);
  bytes[0] = 0x04;
  const offset = append(bytes, 1, unsigned32Bytes(text.length, `${label} byte length`));
  append(bytes, offset, text);
  return bytes;
}

function requireAcyclic(value: object, ancestors: Set<object>): void {
  if (ancestors.has(value)) {
    throw new Error('Canonical values must not contain a cycle.');
  }
  ancestors.add(value);
}

/**
 * Canonical index keys, in order, for a dense data array.
 *
 * Validating the whole key set once is what lets the element loop read
 * `value[index]` directly. Asking for a property descriptor per element
 * allocated a descriptor object and an index string for every coordinate in
 * the document, and a 121,000-point network paid that several hundred
 * thousand times to learn what one pass over the keys already establishes.
 */
function requireDenseDataArray(value: readonly unknown[]): void {
  let indexKeys = 0;
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string') {
      throw new Error('Canonical arrays must not contain named or symbol properties.');
    }
    const index = Number(key);
    // `Number` accepts forms an index never takes — ' 1', '1e0', '01', '' —
    // so the round trip is what rejects them, in place of a regex per element.
    if (String(index) !== key) {
      throw new Error('Canonical arrays must not contain named or symbol properties.');
    }
    if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) {
      throw new Error('Canonical arrays contain an invalid item index.');
    }
    indexKeys += 1;
  }
  // A hole has no own key, so a short count is exactly a sparse array.
  if (indexKeys !== value.length) {
    throw new Error('Canonical arrays must be dense data arrays.');
  }
}

function encodeArray(value: readonly unknown[], ancestors: Set<object>): Uint8Array {
  requireUnsigned32(value.length, 'Canonical array item count');
  requireAcyclic(value, ancestors);
  try {
    requireDenseDataArray(value);

    // Density is established above, so iteration cannot observe a hole.
    const items: Uint8Array[] = [];
    for (const item of value) items.push(encodeValue(item, ancestors));
    for (const item of items) {
      requireUnsigned32(item.length, 'Canonical array item byte length');
    }

    // Each item is framed by its length and written straight into the result.
    // Building the framed copies first meant every byte of the document was
    // copied twice before it reached the buffer that gets hashed.
    const bytes = new Uint8Array(encodedTotal(items, 5 + items.length * 4));
    bytes[0] = 0x05;
    let offset = writeUnsigned32(bytes, 1, items.length, 'Canonical array item count');
    for (const item of items) {
      offset = writeUnsigned32(bytes, offset, item.length, 'Canonical array item byte length');
      offset = append(bytes, offset, item);
    }
    return bytes;
  } finally {
    ancestors.delete(value);
  }
}

interface EncodedObjectField {
  key: Uint8Array;
  value: Uint8Array;
}

function encodeObject(value: object, ancestors: Set<object>): Uint8Array {
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Canonical objects must be plain objects.');
  }
  requireAcyclic(value, ancestors);
  try {
    // One descriptor map for the object, rather than a descriptor object
    // allocated per field. The map is still what rejects an accessor, which
    // `Object.entries` would silently invoke instead.
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const fields: EncodedObjectField[] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        throw new Error('Canonical objects must not contain symbol fields.');
      }
      // `Reflect.ownKeys` and the descriptor map come from the same object, so
      // the key is always present here.
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throw new Error('Canonical objects must contain enumerable data fields only.');
      }
      fields.push({
        key: utf8Bytes(key, 'Canonical object key'),
        value: encodeValue(descriptor.value, ancestors),
      });
    }
    requireUnsigned32(fields.length, 'Canonical object field count');
    fields.sort((left, right) => compareUnsignedBytes(left.key, right.key));

    let total = 5;
    for (const field of fields) {
      total += 8 + field.key.length + field.value.length;
      if (!Number.isSafeInteger(total) || total > maximumUnsigned32) {
        throw new Error('Canonical value bytes exceed the unsigned 32-bit limit.');
      }
    }
    // Fields are framed straight into the result. Building each framed field
    // first copied every key and value a second time before assembly.
    const bytes = new Uint8Array(total);
    bytes[0] = 0x06;
    let offset = writeUnsigned32(bytes, 1, fields.length, 'Canonical object field count');
    for (const field of fields) {
      offset = writeUnsigned32(bytes, offset, field.key.length, 'Canonical object key byte length');
      offset = append(bytes, offset, field.key);
      offset = writeUnsigned32(
        bytes,
        offset,
        field.value.length,
        'Canonical object value byte length',
      );
      offset = append(bytes, offset, field.value);
    }
    return bytes;
  } finally {
    ancestors.delete(value);
  }
}

function encodeValue(value: unknown, ancestors: Set<object>): Uint8Array {
  if (value === null) return Uint8Array.of(0x00);
  switch (typeof value) {
    case 'boolean':
      return Uint8Array.of(value ? 0x02 : 0x01);
    case 'number':
      return encodeNumber(value);
    case 'string':
      return encodeString(value, 'Canonical string');
    case 'object':
      return Array.isArray(value) ? encodeArray(value, ancestors) : encodeObject(value, ancestors);
    default:
      throw new Error(`Canonical values cannot encode ${typeof value}.`);
  }
}

export function canonicalValueBytes(value: unknown): Uint8Array {
  return encodeValue(value, new Set());
}
