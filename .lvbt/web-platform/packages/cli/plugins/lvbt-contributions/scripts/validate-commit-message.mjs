import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitSubjectError } from './validate-commit-subject.mjs';

/**
 * The whole-message rules, applied by the commit-msg hook after the subject
 * grammar. The subject validator stays separate because the pull-request
 * helper checks titles with it and has no body to check.
 */
const MAX_BODY_LINE_LENGTH = 72;
const BODY_REQUIRED_TYPES = new Set(['feat', 'fix']);
const trailerPattern = /^[A-Za-z][A-Za-z-]*: /;
const breakingPattern = /^BREAKING[ -]CHANGE: /;
const continuationPattern = /^\s+\S/;
const fencePattern = /^\s*(```|~~~)/;

/** Lines git keeps: comments and the scissors block are stripped. */
function meaningfulLines(text) {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const scissors = lines.findIndex((line) => line.startsWith('# ------------------------ >8'));
  return (scissors === -1 ? lines : lines.slice(0, scissors)).filter(
    (line) => !line.startsWith('#'),
  );
}

function isFooter(line) {
  return trailerPattern.test(line) || breakingPattern.test(line) || continuationPattern.test(line);
}

/** The last blank-line-separated paragraph, when it holds nothing but footers. */
function footerBlock(lines) {
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') last -= 1;
  let start = 0;
  for (let index = last; index >= 1; index -= 1) {
    if (lines[index].trim() === '') {
      start = index + 1;
      break;
    }
  }
  const block = lines.slice(start, last + 1);
  return block.length > 0 && block.every(isFooter) ? block : [];
}

function bodyErrors(lines, type) {
  const errors = [];
  const [, separator = '', ...rest] = lines;
  const footer = footerBlock(lines);
  const body = rest.filter((line) => !footer.includes(line));
  const hasBody = separator.trim() === '' && body.some((line) => line.trim() !== '');

  if (BODY_REQUIRED_TYPES.has(type) && !hasBody) {
    errors.push(
      `A ${type} commit needs a body: leave a blank line after the subject and say what changed for a person using the product and why.`,
    );
  }
  if (lines.length > 1 && separator.trim() !== '') {
    errors.push('Leave a blank line between the subject and the body.');
  }

  let inFence = false;
  for (const line of body) {
    if (fencePattern.test(line)) inFence = !inFence;
    if (inFence || isFooter(line)) continue;
    if (line.length > MAX_BODY_LINE_LENGTH) {
      errors.push(`Wrap the body at ${MAX_BODY_LINE_LENGTH} columns: "${line.slice(0, 40)}…"`);
      break;
    }
  }
  return errors;
}

/**
 * An agent has to say so. prepare-commit-msg writes the footer from the same
 * signal, so reaching this check with none means it was removed or the commit
 * arrived by a path that hook does not cover. A person at a keyboard sets none
 * of these variables, so a hand-written commit needs nothing.
 */
function attributionErrors(lines) {
  const errors = [];
  // The same signals prepare-commit-msg reads, so the two hooks agree on who
  // is driving: AI_AGENT is the cross-vendor spelling, CODEX_SESSION_ID and
  // CLAUDECODE are what Codex and Claude Code set themselves.
  const agentDriven =
    Boolean(process.env.AI_AGENT) ||
    Boolean(process.env.CODEX_SESSION_ID) ||
    process.env.CLAUDECODE === '1';
  const written = lines.filter((line) => /^co-authored-by:/i.test(line));
  const inFooter = footerBlock(lines).filter((line) => /^co-authored-by:/i.test(line));

  if (agentDriven && written.length === 0) {
    errors.push(
      'An agent is committing without attribution. End the message with `Co-Authored-By: <model> <email>`; the prepare-commit-msg hook adds one for you.',
    );
  }
  if (written.length !== inFooter.length) {
    errors.push(
      'A Co-Authored-By trailer must sit in the last block of the message, separated from the body by a blank line, with nothing but other footers beside it.',
    );
  }
  for (const line of written) {
    if (!/^co-authored-by: .+ <[^\s@]+@[^\s@]+>$/i.test(line)) {
      errors.push(
        `An attribution trailer needs a usable address: write it as \`Co-Authored-By: Name <email>\` (got "${line}").`,
      );
    }
  }
  return errors;
}

export function commitMessageErrors(text) {
  const lines = meaningfulLines(text);
  const subject = lines[0] ?? '';
  const subjectError = commitSubjectError(subject);
  if (subjectError) return [subjectError];

  const type = /^(?<type>[a-z]+)/.exec(subject)?.groups?.type ?? '';
  return [...bodyErrors(lines, type), ...attributionErrors(lines)];
}

function isDirectInvocation() {
  return (
    process.argv[1] !== undefined &&
    realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  );
}

if (isDirectInvocation()) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('Usage: validate-commit-message.mjs <commit-message-file>\n');
    process.exitCode = 2;
  } else {
    const errors = commitMessageErrors(readFileSync(file, 'utf8'));
    if (errors.length > 0) {
      process.stderr.write(`Commit blocked:\n${errors.map((error) => `  ${error}`).join('\n')}\n`);
      process.exitCode = 1;
    }
  }
}
