import type { LngLat } from '../../transit/value-types';

export type ValueParser<Value> = (value: unknown, label: string) => Value;

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function exactRecord(
  value: unknown,
  label: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}.`);
  }
  for (const key of requiredKeys) {
    if (!hasOwn(record, key)) throw new Error(`${label} is missing field ${key}.`);
  }
  return record;
}

export function parseArray<Value>(
  value: unknown,
  label: string,
  parser: ValueParser<Value>,
): Value[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((item, index) => parser(item, `${label}[${index}]`));
}

export function parseText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must not be blank.`);
  }
  return value;
}

export function parseString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

export function parseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

export function parseFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
  return value;
}

export function parseNonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer.`);
  }
  return value;
}

export function parsePositiveInteger(value: unknown, label: string): number {
  const parsed = parseNonnegativeInteger(value, label);
  if (parsed === 0) throw new Error(`${label} must be positive.`);
  return parsed;
}

export function parsePositiveNumber(value: unknown, label: string): number {
  const parsed = parseFiniteNumber(value, label);
  if (parsed <= 0) throw new Error(`${label} must be positive.`);
  return parsed;
}

export function parseEnum<const Values extends readonly string[]>(
  value: unknown,
  label: string,
  values: Values,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function parseLngLat(value: unknown, label: string): LngLat {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must be a longitude-latitude coordinate.`);
  }
  const longitude = parseFiniteNumber(value[0], `${label} longitude`);
  const latitude = parseFiniteNumber(value[1], `${label} latitude`);
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error(`${label} coordinate is outside geographic bounds.`);
  }
  return [longitude, latitude];
}

export function parseUniqueTextArray(value: unknown, label: string): string[] {
  const values = parseArray(value, label, parseText);
  const unique = new Set(values);
  if (unique.size !== values.length) throw new Error(`${label} contains duplicate values.`);
  return values;
}

export function parseComponentMap<Value>(
  value: unknown,
  label: string,
  parser: ValueParser<Value>,
): Record<string, Value> {
  const record = exactRecord(value, label, Object.keys(value ?? {}));
  const parsed: Record<string, Value> = {};
  for (const [key, item] of Object.entries(record)) {
    parseText(key, `${label} key`);
    parsed[key] = parser(item, `${label}.${key}`);
  }
  return parsed;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseServiceDate(value: unknown, label: string): string {
  const date = parseText(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`${label} must be a valid service date.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`${label} must be a valid service date.`);
  }
  return date;
}

export function parseInstant(value: unknown, label: string): string {
  const instant = parseText(value, label);
  if (!Number.isFinite(Date.parse(instant))) throw new Error(`${label} must be a valid timestamp.`);
  return instant;
}

export function parseSha256(value: unknown, label: string): string {
  const digest = parseText(value, label);
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`${label} must be 64 lowercase hexadecimal digits.`);
  }
  return digest;
}
