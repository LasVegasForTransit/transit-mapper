import { canonicalValueBytes } from './canonical-value';
import type { ContentDigest } from '../source/value-types';

type JsonSemanticValue =
  null | boolean | number | string | JsonSemanticValue[] | JsonSemanticObject;

interface JsonSemanticObject {
  [key: string]: JsonSemanticValue;
}

/**
 * Canonical content treats an omitted optional object field and an undefined
 * object field alike. Arrays cannot do that because positions carry meaning.
 */
function semanticJsonValue(value: unknown, path = 'value'): JsonSemanticValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a nonfinite number.`);
    return value;
  }
  if (Array.isArray(value)) return semanticJsonArray(value, path);
  if (typeof value !== 'object') throw new Error(`${path} is not JSON data.`);
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    throw new Error(`${path} is not a plain JSON object.`);
  }
  const result: JsonSemanticObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = semanticJsonValue(item, `${path}.${key}`);
  }
  return result;
}

function semanticJsonArray(value: unknown[], path: string): JsonSemanticValue[] {
  return value.map((item, index) => {
    if (item === undefined) throw new Error(`${path}[${index}] is undefined.`);
    return semanticJsonValue(item, `${path}[${index}]`);
  });
}

async function sha256(bytes: Uint8Array): Promise<ContentDigest> {
  const buffer = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  const value = Array.from(new Uint8Array(buffer), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return { algorithm: 'sha-256', value };
}

/** Returns the SHA-256 identity of canonical JSON-like content. */
export async function semanticDigest(value: unknown): Promise<ContentDigest> {
  return sha256(canonicalValueBytes(semanticJsonValue(value)));
}
