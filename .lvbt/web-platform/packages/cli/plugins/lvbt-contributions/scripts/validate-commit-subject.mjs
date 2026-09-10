import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The plugin owns the shared subject grammar, but a repository owns the names
 * of its durable boundaries. Reading the policy from the calling repository
 * keeps a source consumer from silently imposing its own vocabulary on every
 * other LVBT project.
 */
const scopePolicyRelativePath = '.lvbt/commit-scopes.txt';
const scopePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const commitTypes = Object.freeze(
  readFileSync(new URL('../standards/commit-types.txt', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')),
);

const subjectPattern = /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9-]+)\))?: \S.*$/;

function choices(values) {
  return values.map((value) => `\`${value}\``).join(', ');
}

function scopePolicyPath(startDirectory) {
  let directory = resolve(startDirectory);
  while (true) {
    const candidate = resolve(directory, scopePolicyRelativePath);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function commitScopes(startDirectory) {
  const policyPath = scopePolicyPath(startDirectory);
  if (!policyPath) {
    return {
      error: `No ${scopePolicyRelativePath} policy was found. Each repository must declare its own durable commit scopes.`,
    };
  }

  const scopes = readFileSync(policyPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const invalidScope = scopes.find((scope) => !scopePattern.test(scope));
  if (invalidScope) {
    return {
      error: `The ${scopePolicyRelativePath} policy contains invalid scope \`${invalidScope}\`.`,
    };
  }
  if (new Set(scopes).size !== scopes.length) {
    return {
      error: `The ${scopePolicyRelativePath} policy declares a scope more than once.`,
    };
  }
  return { scopes: Object.freeze(scopes) };
}

export function commitSubjectError(subject) {
  const scopeResult = commitScopes(process.cwd());
  if ('error' in scopeResult) return scopeResult.error;

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
  if (scope && !scopeResult.scopes.includes(scope)) {
    return `Scope \`${scope}\` is not allowed. Use ${choices(scopeResult.scopes)}, or omit the scope for cross-boundary work.`;
  }
  return undefined;
}

function isDirectInvocation() {
  // Compare real paths: consumers reach this file through node_modules, where
  // pnpm symlinks the package, while ESM resolves import.meta.url to the real
  // location. Comparing the symlinked argv path against it never matched, so
  // the hook exited 0 without validating anything.
  return (
    process.argv[1] !== undefined &&
    realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  );
}

if (isDirectInvocation()) {
  const error = commitSubjectError(process.argv[2] ?? '');
  if (error) {
    process.stderr.write(`Commit blocked: ${error}\n`);
    process.exitCode = 1;
  }
}
