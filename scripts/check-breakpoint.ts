#!/usr/bin/env tsx
/**
 * The layout condition is declared in three places, and all three are
 * load-bearing.
 *
 * `packages/workspace/src/media-query.ts` decides which component tree mounts.
 * The workspace and application stylesheets repeat the same condition in every media query that has to move with that
 * tree, and separately declares `--breakpoint-md` so Tailwind's `md:`
 * utilities agree about the width half. Mounting a tree on one side of a
 * boundary while styling it for the other produces a layout nobody wrote and
 * no test renders.
 *
 * They already diverged once — 760px in the stylesheet against 767px in the
 * hook — for long enough that a comment claiming the two matched was written
 * underneath the mismatch. A comment is the thing that failed here, so this is
 * a check instead.
 *
 * The condition is a comma list, and both halves matter:
 *
 *   (max-width: 767px), (max-height: 500px)
 *
 * The height clause is why `md:` is NOT equivalent and must not be used to
 * fork layout — a phone in landscape is 844px wide and would take the desktop
 * branch. Tailwind cannot express it, so this check makes sure the CSS spells
 * the whole condition out wherever it mirrors the fork.
 *
 * The two width numbers are deliberately off by one: the CSS token is a
 * `min-width` boundary and the query is its `max-width` complement.
 *
 * Usage: `pnpm check:breakpoint` — exit 0 = they agree, exit 1 = they do not.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CAPABILITIES = 'packages/workspace/src/media-query.ts';
const STYLESHEETS = ['apps/web/src/ui/app.css', 'packages/workspace/src/workbench.css'];

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function fail(message: string): never {
  console.error(`breakpoint: ${message}`);
  process.exit(1);
}

const capabilities = read(CAPABILITIES);
const stylesheets = STYLESHEETS.map((path) => ({ path, source: read(path) }));
const applicationStylesheet = stylesheets[0];
if (!applicationStylesheet) fail('the application stylesheet list is empty.');

const declaration = /COMPACT_LAYOUT_QUERY\s*=\s*'([^']+)'/.exec(capabilities);
if (!declaration) {
  fail(`could not find COMPACT_LAYOUT_QUERY in ${CAPABILITIES}. Update this check with it.`);
}
const condition = declaration[1];
if (condition === undefined) {
  fail(`COMPACT_LAYOUT_QUERY in ${CAPABILITIES} has no readable value. Update this check.`);
}

const compactWidth = /\(max-width:\s*(\d+)px\)/.exec(condition);
if (!compactWidth) {
  fail(
    `COMPACT_LAYOUT_QUERY has no (max-width: …) clause: "${condition}".\n` +
      `  Something has to pair with --breakpoint-md, or Tailwind's md: utilities\n` +
      `  no longer agree with the tree that mounts.`,
  );
}

const themeToken = /--breakpoint-md:\s*(\d+)px/.exec(applicationStylesheet.source);
if (!themeToken) {
  fail(
    `could not find --breakpoint-md in ${applicationStylesheet.path}. Update this check with it.`,
  );
}

const compactMax = Number(compactWidth[1]);
const themeMin = Number(themeToken[1]);

if (themeMin !== compactMax + 1) {
  fail(
    `${applicationStylesheet.path} styles for a boundary at ${themeMin}px while ${CAPABILITIES} mounts for one at ${compactMax + 1}px.\n` +
      `  --breakpoint-md must be exactly one more than COMPACT_LAYOUT_QUERY's max-width.\n` +
      `  Fix: set --breakpoint-md to ${compactMax + 1}px, or the clause to (max-width: ${themeMin - 1}px).`,
  );
}

/**
 * Every media query in the stylesheet that mentions the width boundary must
 * spell out the WHOLE condition, not just the width half.
 *
 * This is the check that would have caught the landscape-phone gap: a rule
 * written as `@media (max-width: 767px)` alone stops applying at 844x390,
 * where the compact tree is mounted and needs it — the tool dock's icon-only
 * sizing and MapLibre's clearance both live in such a block.
 *
 * Content-fit thresholds (860px, 620px, 339px) are deliberately width-only
 * and are not this boundary, so they are not matched here.
 */
const normalise = (value: string) => value.replace(/\s+/g, ' ').trim();
const wanted = normalise(condition);
// Comments quote the condition — that is the point of them — so scanning the
// raw text finds the prose as well as the rules and reports it as a rule that
// disagrees with itself.
const offenders = stylesheets.flatMap(({ path, source }) => {
  const rules = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...rules.matchAll(/@media\s+([^{]+)\{/g)]
    .map((match) => normalise(match[1] ?? ''))
    .filter((query) => query.includes(`max-width: ${compactMax}px`))
    .filter((query) => query !== wanted)
    .map((query) => ({ path, query }));
});

if (offenders.length > 0) {
  fail(
    `The stylesheets have ${offenders.length} media quer${offenders.length === 1 ? 'y' : 'ies'} at the layout boundary that\n` +
      `  do not spell out the whole condition:\n` +
      offenders.map(({ path, query }) => `    ${path}: @media ${query}`).join('\n') +
      `\n  Each must read exactly:\n    @media ${wanted}\n` +
      `  A width-only copy stops applying on a short screen — a phone in\n` +
      `  landscape is ${compactMax + 77}px wide — while the compact tree is still mounted.`,
  );
}

console.log(
  `breakpoint: the layout condition is "${wanted}" in both places, ` +
    `and --breakpoint-md is ${themeMin}px.`,
);
