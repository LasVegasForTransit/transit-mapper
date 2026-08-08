#!/usr/bin/env tsx
/**
 * Generates docs/development/reference/checks.md from the check registry.
 *
 * A hand-written list of checks drifts the first time someone adds one and
 * forgets the page, and a reference that is wrong is worse than none: it
 * tells people a guard exists that does not. So the page is generated, and
 * `--check` fails when the committed copy no longer matches — which is how a
 * new check ends up documented without anybody having to remember.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'docs/development/reference/checks.md');

interface Check {
  /** The script name in package.json, or the layer it runs at. */
  command: string;
  fails: string;
  fix: string;
}

/**
 * The registry. Adding a check to `pnpm check` without adding it here fails
 * the staleness check, which is the point.
 */
const CHECKS: Check[] = [
  {
    command: 'format:check',
    fails: 'a file is not Prettier-formatted',
    fix: 'pnpm format',
  },
  {
    command: 'lint',
    fails: 'a lint rule is violated, including the repository-specific ones',
    fix: 'pnpm lint:fix',
  },
  {
    command: 'typecheck:root',
    fails: 'repository tooling — scripts/, turbo/, or eslint.config.ts — does not compile',
    fix: 'fix the type error; do not add `any`',
  },
  {
    command: 'check:filenames',
    fails: 'a file under a module src/ or tests/ tree does not follow its filename contract',
    fix: 'rename the file and update its imports',
  },
  {
    command: 'check:contract',
    fails:
      'a package is missing a required task, pins a version outside the catalog, or keeps test material outside its tests/ directory',
    fix: 'add the script, use the catalog, or move the test under the owning package tests/ tree',
  },
  {
    command: 'check:docs',
    fails: 'a relative link or anchor in docs/ does not resolve',
    fix: 'correct the link, or write the page it points at',
  },
  {
    command: 'check:migrations',
    fails: 'a migration that already exists was edited, renamed or deleted',
    fix: 'restore the file and add a new migration with the change',
  },
  {
    command: 'check:structure',
    fails:
      'the project map hierarchy is malformed, a source module is missing beneath its owner, or a described path is gone',
    fix: 'describe the module beneath its package or application, or remove the stale locator',
  },
  {
    command: 'check:breakpoint',
    fails: 'the layout breakpoint in the stylesheet and the capability module disagree',
    fix: "set --breakpoint-md to one more than COMPACT_LAYOUT_QUERY's max-width",
  },
  {
    command: 'check:config',
    fails: 'a tool is configured under a name other than `<tool>.config.<ext>`',
    fix: 'rename the file, or record the tool in scripts/check-config.ts',
  },
  {
    command: 'check:debt',
    fails:
      'a suppression ledger gained an entry, or a suppressed file was changed without shrinking',
    fix: 'fix the finding rather than recording it, then `eslint --prune-suppressions`',
  },
  {
    command: 'check:deadcode',
    fails: 'a file, export, type, or dependency is unreferenced',
    fix: 'delete it — or declare the entry point in knip.config.ts if it is reached from outside the import graph',
  },
  {
    command: 'check:duplication',
    fails: 'copy-pasted code exceeds the recorded share of the codebase',
    fix: 'extract the shared part, or lower nothing — the threshold only goes down',
  },
  {
    command: 'check:boundaries',
    fails: 'a module imports across a boundary the project map forbids, or a cycle exists',
    fix: 'move the shared code into packages/core, or break the cycle',
  },
  {
    command: 'check:documents',
    fails:
      'a required document is missing, lacks a required section, has them out of order, or uses a stock phrase',
    fix: 'add the section or cut the phrase — see docs/development/reference/document-standards.md',
  },
  {
    command: 'check:reference',
    fails: 'this page no longer matches the registry it is generated from',
    fix: 'pnpm gen:checks',
  },
  {
    command: 'check:types',
    fails: 'worker-configuration.d.ts no longer matches wrangler.toml',
    fix: 'pnpm --filter @transitmapper/worker types',
  },
  {
    command: 'check:icons',
    fails: 'generated app icons no longer match their source and provenance',
    fix: 'pnpm --filter @transitmapper/web generate:icons',
  },
  {
    command: 'typecheck',
    fails: 'TypeScript rejects the code in any package',
    fix: 'fix the type error',
  },
  {
    command: 'verify',
    fails: 'a test fails',
    fix: 'fix the code, or the test if the test was wrong',
  },
];

/** Checks that exist but deliberately run somewhere other than `pnpm check`. */
const ELSEWHERE: Check[] = [
  {
    command: 'check:generators (CI)',
    fails: 'a generator emits code that does not pass pnpm check',
    fix: 'run the generator by hand and repair the template',
  },
  {
    command: 'check:env (pre-push)',
    fails: 'node_modules disagrees with the lockfile',
    fix: 'pnpm install --frozen-lockfile',
  },
  {
    command: 'gitleaks (pre-commit, CI)',
    fails: 'a secret appears in the changes',
    fix: 'remove it, then rotate it — assume it is burned',
  },
  {
    command: 'pnpm preflight',
    fails: 'the toolchain, Cloudflare resources, or GitHub governance differ from the standard',
    fix: 'pnpm bootstrap',
  },
  {
    command: 'commit-msg hook',
    fails: 'the subject is not a conventional commit, or exceeds 72 characters',
    fix: 'reword the commit',
  },
  {
    command: 'commit-msg hook',
    fails: 'a Co-Authored-By footer sits outside the footer block, or has no address',
    fix: 'move it to the end of the message, as Name <email>',
  },
  {
    command: 'commit-msg hook',
    fails: 'an agent is committing with no Co-Authored-By footer',
    fix: 'end the message with the model that wrote it',
  },
];

function table(checks: Check[]): string {
  const rows = checks.map((c) => `| \`${c.command}\` | ${c.fails} | \`${c.fix}\` |`);
  return ['| Check | Fails when | Fix |', '| --- | --- | --- |', ...rows].join('\n');
}

function render(): string {
  return `<!-- Generated by scripts/generate-checks-reference.ts. Do not edit by hand;
     run \`pnpm gen:checks\` after changing the registry in that file. -->

# Checks

Everything \`pnpm check\` runs, what makes each one fail, and what fixes it.

\`\`\`bash
pnpm check        # all of it
pnpm check --fix  # everything a machine can repair
\`\`\`

${table(CHECKS)}

## Checks that run elsewhere

Not every guard belongs in \`pnpm check\`. These run at a layer where they
make sense — a disposable CI runner, or the moment before a push.

${table(ELSEWHERE)}

## Adding a check

Add it to \`pnpm check\` in \`package.json\`, then to the registry in
\`scripts/generate-checks-reference.ts\`, then run \`pnpm gen:checks\`. The
staleness check fails until this page matches, so the documentation cannot
be the step that gets skipped.

Every check must name the command that fixes it. A failure that leaves
someone guessing is a defect in the check, not in the person.
`;
}

async function main(): Promise<void> {
  // Formatted through Prettier here, so this page satisfies format:check
  // and the staleness comparison at the same time. Generating unformatted
  // output made the two checks contradict each other.
  const config = await resolveConfig(OUT);
  const rendered = await format(render(), { ...config, filepath: OUT });
  if (process.argv.includes('--check')) {
    const committed = readFileSync(OUT, 'utf8');
    if (committed !== rendered) {
      console.error('\ndocs/development/reference/checks.md is out of date.\n');
      console.error('  It is generated from the registry in');
      console.error('  scripts/generate-checks-reference.ts, and no longer matches it.\n');
      console.error('  fix:  pnpm gen:checks\n');
      process.exit(1);
    }
    console.log('checks reference: up to date.');
    return;
  }
  writeFileSync(OUT, rendered, 'utf8');
  console.log(`checks reference: wrote ${CHECKS.length + ELSEWHERE.length} entries.`);
}

await main();
