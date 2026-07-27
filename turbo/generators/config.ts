import type { PlopTypes } from '@turbo/gen';
import { readdirSync } from 'node:fs';

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
