function invalid(section, index, reason) {
  throw new Error(
    `pnpm-workspace.yaml ${section}, line ${index + 1}: ${reason}. Use a scalar mapping with two-space indentation.`,
  );
}

function quotedToken(text, section, index) {
  const quote = text[0];
  let cursor = 1;
  while (cursor < text.length) {
    if (quote === '"' && text[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (text[cursor] !== quote) {
      cursor++;
      continue;
    }
    if (quote === "'" && text[cursor + 1] === "'") {
      cursor += 2;
      continue;
    }
    const raw = text.slice(0, cursor + 1);
    try {
      return {
        value: quote === '"' ? JSON.parse(raw) : raw.slice(1, -1).replaceAll("''", "'"),
        raw,
      };
    } catch {
      invalid(section, index, 'unsupported quoted scalar');
    }
  }
  invalid(section, index, 'unterminated quoted scalar');
}

function scalar(text, section, index) {
  const token = /^["']/u.test(text)
    ? quotedToken(text, section, index)
    : { raw: text.match(/^[^\s]+/u)?.[0] ?? '' };
  const value = token.value ?? token.raw;
  const rest = text.slice(token.raw.length);
  if (
    !value ||
    (token.value === undefined && /(?:^(?:[,\]{}[&*!|>@%`#]|[?:-]$)|:$)/u.test(value)) ||
    !/^(?:\s+#.*|\s*)$/u.test(rest)
  )
    invalid(section, index, 'unsupported or malformed scalar value');
  return { value, raw: token.raw };
}

function mappingKey(text, section, index) {
  const token = /^["']/u.test(text) ? quotedToken(text, section, index) : undefined;
  const plain = token ? undefined : /^([^:]+):(?:\s|$)/u.exec(text);
  const key = token?.value ?? plain?.[1].trim();
  const rest = token ? text.slice(token.raw.length) : text.slice(plain?.[1].length ?? 0);
  if (
    !key ||
    (!token && /(?:^(?:[,\]{}[&*!|>@%`]|[?-]\s|<<$)|\s#)/u.test(key)) ||
    !/^:\s+/u.test(rest)
  )
    invalid(section, index, 'unsupported mapping key or missing scalar');
  const gap = /^:\s+/u.exec(rest)[0];
  return { key, offset: (token?.raw.length ?? plain[1].length) + gap.length };
}

function mappingEntry(line, section, index) {
  if (!/^ {2}\S/u.test(line)) invalid(section, index, 'unsupported indentation or nested mapping');
  const { key, offset } = mappingKey(line.slice(2), section, index);
  const valueStart = 2 + offset;
  const value = scalar(line.slice(valueStart), section, index);
  return {
    key,
    value: value.value,
    index,
    valueStart,
    valueLength: value.raw.length,
    quote: /^["']/u.test(value.raw) ? value.raw[0] : '',
  };
}

function sectionHeader(line, name) {
  return new RegExp(`^(?:${name}|'${name}'|"${name}")(?:\\s|:|$)`, 'u').test(line);
}

function validateHeader(line, name, index, start) {
  if (start !== -1) invalid(name, index, 'duplicate section');
  if (!new RegExp(`^(?:${name}|'${name}'|"${name}")\\s*:(?:\\s+#.*|\\s*)$`, 'u').test(line))
    invalid(name, index, 'unsupported section syntax');
}

/** Supported scalar subset only; no guessed YAML interpretation in controlled sections. */
export function scalarSection(source, name) {
  const lines = source.split(/\r?\n/u);
  const entries = {};
  const records = [];
  let start = -1;
  let end = lines.length - (lines.at(-1) === '' ? 1 : 0);
  let active = false;
  for (const [index, line] of lines.entries()) {
    if (sectionHeader(line, name)) {
      validateHeader(line, name, index, start);
      start = index;
      active = true;
      continue;
    }
    if (!active || /^\s*(?:#.*)?$/u.test(line)) continue;
    if (/^\S/u.test(line)) {
      end = index;
      active = false;
      continue;
    }
    const entry = mappingEntry(line, name, index);
    if (Object.hasOwn(entries, entry.key)) invalid(name, index, `duplicate key "${entry.key}"`);
    Object.defineProperty(entries, entry.key, { value: entry.value, enumerable: true });
    records.push(entry);
  }
  return { entries, records, start, end };
}

/** Compatibility export for callers using the original catalog parser. */
export function catalogEntries(source) {
  return scalarSection(source, 'catalog').entries;
}

function auditedOverrides(policy) {
  if (
    !policy ||
    typeof policy !== 'object' ||
    Array.isArray(policy) ||
    Object.entries(policy).some(
      ([key, value]) =>
        !key || /[\r\n]/u.test(key) || typeof value !== 'string' || !value || /[\r\n]/u.test(value),
    )
  )
    throw new Error('Shared catalog.json overrides must be a scalar string mapping.');
  return policy;
}

export function overrideProblems(source, policy) {
  const { entries } = scalarSection(source, 'overrides');
  return Object.entries(auditedOverrides(policy)).flatMap(([key, value]) =>
    Object.hasOwn(entries, key) && entries[key] === value
      ? []
      : [
          `pnpm-workspace.yaml overrides "${key}" is ${Object.hasOwn(entries, key) ? `"${entries[key]}"` : 'missing'}; shared audited policy requires "${value}".`,
        ],
  );
}

function replacementValue(value, quote) {
  if (quote === "'") return `'${value.replaceAll("'", "''")}'`;
  return quote === '"' ? JSON.stringify(value) : value;
}

function quotedYamlScalar(value) {
  // Shared Prettier uses singleQuote. Double quotes avoid YAML apostrophe escaping where needed.
  return value.includes("'") || [...value].some((character) => character.charCodeAt(0) < 32)
    ? JSON.stringify(value)
    : `'${value}'`;
}

/** Change shared pins alone; leave app-only overrides, comments and other pnpm fields intact. */
export function updateOverrides(source, policy) {
  scalarSection(source, 'catalog');
  const section = scalarSection(source, 'overrides');
  const canonical = auditedOverrides(policy);
  const lines = source.split(/\r?\n/u);
  for (const record of section.records) {
    if (!Object.hasOwn(canonical, record.key) || canonical[record.key] === record.value) continue;
    const line = lines[record.index];
    lines[record.index] =
      line.slice(0, record.valueStart) +
      replacementValue(canonical[record.key], record.quote) +
      line.slice(record.valueStart + record.valueLength);
  }
  const additions = Object.entries(canonical)
    .filter(([key]) => !Object.hasOwn(section.entries, key))
    .map(([key, value]) => `  ${quotedYamlScalar(key)}: ${quotedYamlScalar(value)}`);
  if (additions.length) {
    if (section.start === -1) lines.splice(section.end, 0, 'overrides:', ...additions);
    else lines.splice(section.end, 0, ...additions);
  }
  return lines.join(source.includes('\r\n') ? '\r\n' : '\n');
}
