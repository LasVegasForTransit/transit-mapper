import { isDeepStrictEqual } from 'node:util';

/**
 * The subset of JSON Schema that platform.schema.json uses, interpreted
 * directly so the schema file stays the one definition of a valid manifest.
 * A test fails when the schema uses a keyword outside this list, so the two
 * cannot drift apart silently.
 */
export const SUPPORTED_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$defs',
  '$ref',
  'title',
  'description',
  'type',
  'const',
  'enum',
  'pattern',
  'minLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'uniqueItems',
  'items',
  'properties',
  'propertyNames',
  'required',
  'additionalProperties',
]);

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function resolve(root, reference) {
  const target = reference.startsWith('#/')
    ? reference
        .slice(2)
        .split('/')
        .reduce((value, key) => {
          const decoded = key.replaceAll('~1', '/').replaceAll('~0', '~');
          return value && Object.hasOwn(value, decoded) ? value[decoded] : undefined;
        }, root)
    : undefined;
  if (!target) throw new Error(`Unsupported or unknown schema reference ${reference}.`);
  return target;
}

function checkString(schema, value, at, errors) {
  if (schema.minLength !== undefined && value.length < schema.minLength)
    errors.push(`${at}: must not be empty.`);
  if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value))
    errors.push(`${at}: "${value}" does not match ${schema.pattern}.`);
}

function checkArray(walker, schema, value, at) {
  if (schema.minItems !== undefined && value.length < schema.minItems)
    walker.errors.push(`${at}: needs at least ${schema.minItems} item(s).`);
  if (schema.maxItems !== undefined && value.length > schema.maxItems)
    walker.errors.push(`${at}: permits at most ${schema.maxItems} item(s).`);
  if (
    schema.uniqueItems &&
    value.some((item, i) => value.slice(0, i).some((other) => isDeepStrictEqual(item, other)))
  )
    walker.errors.push(`${at}: items must be unique.`);
  if (schema.items)
    value.forEach((item, index) => visit(walker, schema.items, item, `${at}[${index}]`));
}

function checkObject(walker, schema, value, at) {
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) walker.errors.push(`${at}: "${key}" is required.`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (schema.propertyNames) visit(walker, schema.propertyNames, key, `${at} property ${key}`);
    const property = Object.hasOwn(schema.properties ?? {}, key)
      ? schema.properties[key]
      : undefined;
    if (property) visit(walker, property, child, `${at}.${key}`);
    else if (schema.additionalProperties === false)
      walker.errors.push(`${at}: "${key}" is not a known field.`);
    else if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
      visit(walker, schema.additionalProperties, child, `${at}.${key}`);
  }
}

/** The first way `value` breaks the schema's own constraints, or undefined. */
function mismatch(schema, value) {
  if ('const' in schema && value !== schema.const) return `must be ${JSON.stringify(schema.const)}`;
  if (schema.enum && !schema.enum.includes(value))
    return `must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`;
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum)
      return `must be at least ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum)
      return `must be at most ${schema.maximum}`;
  }
  const actual = typeOf(value);
  if (schema.type && actual !== schema.type)
    return `must be ${schema.type === 'array' ? 'an array' : `a ${schema.type}`}`;
  return undefined;
}

function visit(walker, schema, value, at) {
  if (schema.$ref) {
    visit(walker, resolve(walker.root, schema.$ref), value, at);
    return;
  }
  const problem = mismatch(schema, value);
  if (problem) {
    walker.errors.push(`${at}: ${problem}.`);
    return;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum)
      return `must be at least ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum)
      return `must be at most ${schema.maximum}`;
  }
  const actual = typeOf(value);
  if (actual === 'string') checkString(schema, value, at, walker.errors);
  else if (actual === 'array') checkArray(walker, schema, value, at);
  else if (actual === 'object') checkObject(walker, schema, value, at);
}

/** Every way `value` breaks `schema`, as readable lines. Empty when it is valid. */
export function validateAgainstSchema(schema, value) {
  const walker = { root: schema, errors: [] };
  visit(walker, schema, value, '$');
  return walker.errors;
}

/** Every keyword the schema uses that this interpreter would ignore. */
export function unsupportedKeywords(schema) {
  const found = new Set();
  const walk = (node, isMap) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (isMap) walk(child, false);
      else {
        if (!SUPPORTED_KEYWORDS.has(key)) found.add(key);
        if (key === 'properties' || key === '$defs') walk(child, true);
        else if (['items', 'additionalProperties', 'propertyNames'].includes(key))
          walk(child, false);
      }
    }
  };
  walk(schema, false);
  return [...found];
}
