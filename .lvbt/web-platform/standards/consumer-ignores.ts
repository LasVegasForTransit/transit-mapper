import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Playwright writes these beside each app's configuration, such as apps/site/test-results/.
// Every example's .gitignore carries the same rules. A slash inside a pattern anchors it to the
// .gitignore's own directory, so the cache rule needs its leading **/ to reach every app.
export const PLAYWRIGHT_OUTPUT_IGNORES = [
  'test-results/',
  'playwright-report/',
  'blob-report/',
  '**/playwright/.cache/',
];

// Claude Code creates each agent worktree, a full checkout of the same repository on another
// branch, under .claude/worktrees/ inside the checkout. Git, Prettier, and markdownlint would
// otherwise treat another session's files as this repository's own.
export const AGENT_WORKTREES = '.claude/worktrees';
const AGENT_WORKTREES_REASON = 'Agent worktrees are other checkouts of this repository.';

/** The rules each root ignore file must hold, as the examples hold them. */
const LINE_RULES: Record<string, string[]> = {
  '.gitignore': [...PLAYWRIGHT_OUTPUT_IGNORES, `${AGENT_WORKTREES}/`],
  '.prettierignore': [`${AGENT_WORKTREES}/`],
};

const MARKDOWNLINT_CONFIG = '.markdownlint-cli2.jsonc';
// markdownlint-cli2's other configuration formats, which the updater doesn't edit.
const OTHER_MARKDOWNLINT_CONFIGS = [
  '.markdownlint-cli2.yaml',
  '.markdownlint-cli2.cjs',
  '.markdownlint-cli2.mjs',
];

/** What the consumer must change by hand: a markdownlint configuration the updater can't edit. */
export async function consumerIgnoreWarnings(root: string): Promise<string[]> {
  const warnings: string[] = [];
  for (const name of OTHER_MARKDOWNLINT_CONFIGS) {
    const source = await readFile(path.join(root, name), 'utf8').catch(() => null);
    if (source !== null && !source.includes(AGENT_WORKTREES))
      warnings.push(
        `Add "${AGENT_WORKTREES}" to the ignores in ${name}. ${AGENT_WORKTREES_REASON}`,
      );
  }
  return warnings;
}

/**
 * Adds the standard's ignore rules that a consumer's root ignore files lack, leaving their own
 * lines, comments, and order untouched. A file the consumer doesn't have stays absent.
 */
export async function syncConsumerIgnores(root: string, dryRun: boolean): Promise<string[]> {
  const changed: string[] = [];
  for (const [name, rules] of Object.entries(LINE_RULES)) {
    if (await appendMissingLines(path.join(root, name), rules, dryRun)) changed.push(name);
  }
  const file = path.join(root, MARKDOWNLINT_CONFIG);
  const source = await readFile(file, 'utf8').catch(() => null);
  if (source !== null) {
    const next = addMarkdownlintIgnore(source, AGENT_WORKTREES, AGENT_WORKTREES_REASON);
    if (next !== source) {
      if (!dryRun) await writeFile(file, next);
      changed.push(MARKDOWNLINT_CONFIG);
    }
  }
  return changed;
}

async function appendMissingLines(file: string, rules: string[], dryRun: boolean) {
  const source = await readFile(file, 'utf8').catch(() => null);
  if (source === null) return false;
  const present = new Set(source.split(/\r?\n/).map(patternKey));
  const missing = rules.filter((rule) => !present.has(patternKey(rule)));
  if (missing.length === 0) return false;
  const eol = lineEnding(source);
  const separator = source === '' || source.endsWith('\n') ? '' : eol;
  if (!dryRun) await writeFile(file, `${source}${separator}${missing.join(eol)}${eol}`);
  return true;
}

/** The line ending a file already uses, so added lines match it. */
function lineEnding(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * An ignore pattern without the spellings that don't change what it covers here: a trailing `/` or
 * `/**`, a leading `./`, and a leading `/` when another slash anchors the pattern anyway.
 */
function patternKey(pattern: string): string {
  const bare = pattern
    .trim()
    .replace(/^\.\//, '')
    .replace(/\/(?:\*\*)?$/, '');
  return bare.startsWith('/') && bare.slice(1).includes('/') ? bare.slice(1) : bare;
}

interface Token {
  text: string;
  value?: string;
  start: number;
  end: number;
}

/** Where the comment that starts at `index` ends, or `index` when none starts there. */
function commentEnd(source: string, index: number): number {
  if (source.startsWith('//', index)) {
    const end = source.indexOf('\n', index);
    return end === -1 ? source.length : end;
  }
  if (!source.startsWith('/*', index)) return index;
  const end = source.indexOf('*/', index + 2);
  if (end === -1) throw new Error(`${MARKDOWNLINT_CONFIG} has an unclosed comment.`);
  return end + 2;
}

function stringToken(source: string, start: number): Token {
  let end = start + 1;
  while (end < source.length && source[end] !== '"') end += source[end] === '\\' ? 2 : 1;
  if (end >= source.length) throw new Error(`${MARKDOWNLINT_CONFIG} has an unclosed string.`);
  const text = source.slice(start, end + 1);
  return { text, value: JSON.parse(text) as string, start, end: end + 1 };
}

/** A punctuation mark, or a literal such as `true` or `100`. */
function otherToken(source: string, start: number): Token {
  const character = source.charAt(start);
  if ('{}[]:,'.includes(character)) return { text: character, start, end: start + 1 };
  let end = start;
  while (end < source.length && !/[\s{}[\]:,"/]/.test(source.charAt(end))) end += 1;
  if (end === start) throw new Error(`${MARKDOWNLINT_CONFIG} is not valid JSONC.`);
  return { text: source.slice(start, end), start, end };
}

/** The strings, punctuation, and literals of a JSONC document, without whitespace or comments. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const skipped = /\s/.test(source.charAt(index)) ? index + 1 : commentEnd(source, index);
    if (skipped !== index) {
      index = skipped;
      continue;
    }
    const token = source[index] === '"' ? stringToken(source, index) : otherToken(source, index);
    tokens.push(token);
    index = token.end;
  }
  return tokens;
}

const NESTING = new Map([
  ['{', 1],
  ['[', 1],
  ['}', -1],
  [']', -1],
]);

/** The `[` that opens the top-level `key` array and every token after it, if there is one. */
function topLevelArray(tokens: Token[], key: string): { open: Token; rest: Token[] } | undefined {
  let depth = 0;
  for (const [index, { text, value }] of tokens.entries()) {
    const open = tokens[index + 2];
    if (depth === 1 && value === key && tokens[index + 1]?.text === ':' && open?.text === '[')
      return { open, rest: tokens.slice(index + 3) };
    depth += NESTING.get(text) ?? 0;
  }
  return undefined;
}

/** Whether an array holds `value` as one of its own entries, given the tokens after its `[`. */
function arrayHolds(rest: Token[], value: string): boolean {
  let depth = 0;
  for (const token of rest) {
    depth += NESTING.get(token.text) ?? 0;
    if (depth < 0) return false;
    if (depth === 0 && token.value !== undefined && patternKey(token.value) === patternKey(value))
      return true;
  }
  return false;
}

/** The whitespace that starts the first line after `offset` holding anything else. */
function nextIndentation(source: string, offset: number): { indentation: string; closes: boolean } {
  const match = /\n([ \t]*)(\S)/.exec(source.slice(offset));
  return { indentation: match?.[1] ?? '', closes: match?.[2] === ']' || match?.[2] === '}' };
}

/**
 * Adds `glob` to the top-level `ignores` array of a markdownlint-cli2 configuration, with `reason`
 * as a comment above it. The entry goes first in the array; every existing entry, comment, and
 * blank line stays where it was. A configuration without `ignores` gets the array.
 */
export function addMarkdownlintIgnore(source: string, glob: string, reason: string): string {
  const tokens = tokenize(source);
  const [first] = tokens;
  if (first?.text !== '{') throw new Error(`${MARKDOWNLINT_CONFIG} must hold one object.`);
  const ignores = topLevelArray(tokens, 'ignores');
  if (!ignores) {
    const entry = `"ignores": [${JSON.stringify(glob)}],`;
    return insertAfter(source, first.end, `// ${reason}`, entry);
  }
  if (arrayHolds(ignores.rest, glob)) return source;
  return insertAfter(source, ignores.open.end, `// ${reason}`, `${JSON.stringify(glob)},`);
}

/**
 * Inserts `entry` right after `offset`: on its own line below a `// comment`, indented like the
 * line that follows, or ahead of the next entry when the bracket's contents share its line.
 */
function insertAfter(source: string, offset: number, comment: string, entry: string): string {
  const before = source.slice(0, offset);
  const after = source.slice(offset);
  if (!/^[ \t]*\r?\n/.test(after)) return `${before}${entry} ${after.trimStart()}`;
  const { indentation, closes } = nextIndentation(source, offset);
  const indent = closes ? `${indentation}  ` : indentation;
  const eol = lineEnding(source);
  return `${before}${eol}${indent}${comment}${eol}${indent}${entry}${after}`;
}
