import type { PlopTypes } from '@turbo/gen';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_STRUCTURE = 'docs/development/reference/project-structure.md';

/**
 * The repository root, asked of plop rather than of `import.meta`.
 *
 * `import.meta.dirname` is undefined inside the generator runtime, and
 * `resolve()` throws on it — which plop reports as "no generators found",
 * pointing at the wrong thing entirely.
 */
function repositoryRoot(plop: PlopTypes.NodePlopAPI): string {
  return resolve(plop.getPlopfilePath(), '../..');
}

/** Width of the description column in the tree block. */
const TREE_COLUMN = 17;

interface PackageAnswers {
  name: string;
  purpose: string;
}

/**
 * Writes the new package into the project map.
 *
 * `check:structure` requires every workspace package to appear there, so a
 * generated package fails `pnpm check` the moment it exists unless this runs.
 * The generator already asked for the purpose; before this it collected the
 * answer and threw it away.
 */
function documentPackage(answers: unknown, _config: unknown, plop: PlopTypes.NodePlopAPI): string {
  const { name, purpose } = answers as PackageAnswers;
  const path = `packages/${name}`;
  const doc = resolve(repositoryRoot(plop), PROJECT_STRUCTURE);
  let source = readFileSync(doc, 'utf8');

  if (source.includes(`${path}/`)) return `${path} was already in the project map.`;

  // Into the tree, immediately before `apps/` — the last line of the
  // `packages/` block whatever that block currently contains.
  const label = `  ${name}/`.padEnd(TREE_COLUMN, ' ');
  source = source.replace(/^apps\/$/m, `${label}${purpose}\napps/`);

  // As a section before Testing, which is the tail of the document and not a
  // directory anyone would look for a package under.
  source = source.replace(
    /^## Testing$/m,
    `## ${path}/ — ${purpose}\n\n- \`src/index.ts\` — replace this line with what the package holds.\n\n## Testing`,
  );

  writeFileSync(doc, source, 'utf8');
  return `docs/development/reference/project-structure.md — added ${path}`;
}

/**
 * Generators exist so the checks have less to catch.
 *
 * Every template here emits something that already passes `pnpm check`:
 * required scripts present, catalog-referenced dependencies, a tsconfig
 * leaf, a lint config scope, and a documentation entry where the checks
 * demand one. Scaffolding by hand means discovering each of those from a
 * failure message instead.
 */
export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setGenerator('package', {
    description: 'A workspace package that already satisfies the workspace contract',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Package name, without the @transitmapper/ scope:',
        validate: (input: string) =>
          /^[a-z][a-z0-9-]*$/.test(input) || 'lower-case letters, digits and hyphens',
      },
      {
        type: 'input',
        name: 'purpose',
        message: 'One line on what it is for (goes into project-structure.md):',
        validate: (input: string) => input.trim().length > 0 || 'required',
      },
    ],
    actions: [
      {
        type: 'add',
        path: 'packages/{{name}}/package.json',
        templateFile: 'templates/package/package.json.hbs',
      },
      {
        type: 'add',
        path: 'packages/{{name}}/tsconfig.json',
        templateFile: 'templates/package/tsconfig.json.hbs',
      },
      {
        type: 'add',
        path: 'packages/{{name}}/vitest.config.ts',
        templateFile: 'templates/package/vitest.config.ts.hbs',
      },
      {
        type: 'add',
        path: 'packages/{{name}}/src/index.ts',
        templateFile: 'templates/package/index.ts.hbs',
      },
      {
        type: 'add',
        path: 'packages/{{name}}/src/index.test.ts',
        templateFile: 'templates/package/index.test.ts.hbs',
      },
      documentPackage,
      () => 'Package created. Run `pnpm install` so the workspace link exists, then `pnpm check`.',
    ],
  });

  plop.setGenerator('migration', {
    description: 'The next D1 migration, numbered correctly',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'What the migration does, in snake_case (e.g. add_owner_to_systems):',
        validate: (input: string) =>
          /^[a-z][a-z0-9_]*$/.test(input) || 'lower-case letters, digits and underscores',
      },
    ],
    actions: [
      {
        type: 'add',
        path: 'apps/worker/src/migrations/{{nextMigrationNumber}}_{{name}}.sql',
        templateFile: 'templates/migration.sql.hbs',
      },
      () =>
        'Migration created. It is append-only from now on — check:migrations fails if it is edited later.',
    ],
  });

  plop.setGenerator('lint-rule', {
    description: 'A repository lint rule, its tests, and its documentation anchor',
    prompts: [
      {
        type: 'input',
        name: 'name',
        message: 'Rule name in kebab-case (e.g. no-verb-in-api-path):',
        validate: (input: string) =>
          /^[a-z][a-z0-9-]*$/.test(input) || 'lower-case letters, digits and hyphens',
      },
      {
        type: 'input',
        name: 'description',
        message: 'One line describing what it disallows:',
        validate: (input: string) => input.trim().length > 0 || 'required',
      },
    ],
    actions: [
      {
        type: 'add',
        path: 'packages/eslint-plugin/src/{{name}}.ts',
        templateFile: 'templates/lint-rule/rule.ts.hbs',
      },
      {
        type: 'add',
        path: 'packages/eslint-plugin/src/{{name}}.test.ts',
        templateFile: 'templates/lint-rule/rule.test.ts.hbs',
      },
      () =>
        'Rule created. Register it in packages/eslint-plugin/src/index.ts, scope it in eslint.config.js, and add the matching section to docs/development/explanation/enforcement-model.md — the meta.docs.url anchor points there.',
    ],
  });

  /** Numbers a new migration from the ones already present. */
  plop.setHelper('nextMigrationNumber', () => {
    const dir = 'apps/worker/src/migrations';
    const numbers = readdirSync(dir)
      .map((f) => /^(\d+)_/.exec(f)?.[1])
      .filter((n): n is string => Boolean(n))
      .map(Number);
    const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
    return String(next).padStart(4, '0');
  });
}
