export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

const maximumUnsigned32 = 0xffff_ffff;
const textEncoder = new TextEncoder();

function unsigned32Bytes(value: number, label: string): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximumUnsigned32) {
    throw new Error(`${label} exceeds the canonical unsigned 32-bit limit.`);
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
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
  unsigned32Bytes(bytes.length, `${label} byte length`);
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
  new DataView(bytes.buffer).setFloat64(1, Object.is(value, -0) ? 0 : value, false);
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

function encodeArray(value: readonly unknown[], ancestors: Set<object>): Uint8Array {
  unsigned32Bytes(value.length, 'Canonical array item count');
  requireAcyclic(value, ancestors);
  try {
    const ownKeys = Reflect.ownKeys(value);
    for (const key of ownKeys) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) {
        throw new Error('Canonical arrays must not contain named or symbol properties.');
      }
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= value.length) {
        throw new Error('Canonical arrays contain an invalid item index.');
      }
    }

    const items: Uint8Array[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new Error('Canonical arrays must be dense data arrays.');
      }
      items.push(encodeValue(descriptor.value, ancestors));
    }

    const framedItems = items.map((item) => {
      const framed = new Uint8Array(4 + item.length);
      const offset = append(
        framed,
        0,
        unsigned32Bytes(item.length, 'Canonical array item byte length'),
      );
      append(framed, offset, item);
      return framed;
    });
    const bytes = new Uint8Array(encodedTotal(framedItems, 5));
    bytes[0] = 0x05;
    let offset = append(bytes, 1, unsigned32Bytes(items.length, 'Canonical array item count'));
    for (const item of framedItems) offset = append(bytes, offset, item);
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
    const fields: EncodedObjectField[] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        throw new Error('Canonical objects must not contain symbol fields.');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new Error('Canonical objects must contain enumerable data fields only.');
      }
      fields.push({
        key: utf8Bytes(key, 'Canonical object key'),
        value: encodeValue(descriptor.value, ancestors),
      });
    }
    unsigned32Bytes(fields.length, 'Canonical object field count');
    fields.sort((left, right) => compareUnsignedBytes(left.key, right.key));

    const framedFields = fields.map((field) => {
      const framed = new Uint8Array(8 + field.key.length + field.value.length);
      let offset = append(
        framed,
        0,
        unsigned32Bytes(field.key.length, 'Canonical object key byte length'),
      );
      offset = append(framed, offset, field.key);
      offset = append(
        framed,
        offset,
        unsigned32Bytes(field.value.length, 'Canonical object value byte length'),
      );
      append(framed, offset, field.value);
      return framed;
    });
    const bytes = new Uint8Array(encodedTotal(framedFields, 5));
    bytes[0] = 0x06;
    let offset = append(bytes, 1, unsigned32Bytes(fields.length, 'Canonical object field count'));
    for (const field of framedFields) offset = append(bytes, offset, field);
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
