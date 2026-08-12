import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Scopes identify durable repository boundaries, not the implementation detail
 * that happened to change. Omit a scope when a change spans more than one.
 */
export const commitScopes = Object.freeze([
  'web',
  'worker',
  'core',
  'pwa',
  'dx',
  'tooling',
  'ci',
]);

export const commitTypes = Object.freeze([
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
]);

const subjectPattern = /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9-]+)\))?: \S.*$/;

function choices(values) {
  return values.map((value) => `\`${value}\``).join(', ');
}

export function commitSubjectError(subject) {
  if (subject.length > 72) {
    return `Subject is ${subject.length} characters; the limit is 72 characters.`;
  }

  const match = subjectPattern.exec(subject);
  if (!match?.groups) {
    return 'Use a conventional title: type(optional-scope): description.';
  }

  const { type, scope } = match.groups;
  if (!commitTypes.includes(type)) {
    return `Type \`${type}\` is not allowed. Use ${choices(commitTypes)}.`;
  }
  if (scope && !commitScopes.includes(scope)) {
    return `Scope \`${scope}\` is not allowed. Use ${choices(commitScopes)}, or omit the scope for cross-boundary work.`;
  }
  return undefined;
}

function isDirectInvocation() {
  return (
    process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isDirectInvocation()) {
  const error = commitSubjectError(process.argv[2] ?? '');
  if (error) {
    process.stderr.write(`Commit blocked: ${error}\n`);
    process.exitCode = 1;
  }
}
