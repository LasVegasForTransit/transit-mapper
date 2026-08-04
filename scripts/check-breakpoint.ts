#!/usr/bin/env tsx
/**
 * The layout breakpoint is declared twice, and both copies are load-bearing.
 *
 * `device/capabilities.ts` decides which component tree mounts; `ui/app.css`
 * declares the same boundary to Tailwind so `md:` utilities agree with it.
 * Mounting a tree on one side of a screen width while styling it for the other
 * produces a layout nobody wrote and no test renders.
 *
 * They already diverged once — 760px in the stylesheet against 767px in the
 * hook — for long enough that a comment claiming the two matched was written
 * underneath the mismatch. A comment is the thing that failed here, so this is
 * a check instead.
 *
 * The two numbers are deliberately off by one: the CSS token is a `min-width`
 * boundary and the media query is its `max-width` complement.
 *
 * Usage: `pnpm check:breakpoint` — exit 0 = they agree, exit 1 = they do not.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CAPABILITIES = 'apps/web/src/device/capabilities.ts';
const STYLESHEET = 'apps/web/src/ui/app.css';

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function fail(message: string): never {
  console.error(`breakpoint: ${message}`);
  process.exit(1);
}

const compactQuery = /COMPACT_LAYOUT_QUERY\s*=\s*'\(max-width:\s*(\d+)px\)'/.exec(
  read(CAPABILITIES),
);
if (!compactQuery) {
  fail(`could not find COMPACT_LAYOUT_QUERY in ${CAPABILITIES}. Update this check with it.`);
}

const themeToken = /--breakpoint-md:\s*(\d+)px/.exec(read(STYLESHEET));
if (!themeToken) {
  fail(`could not find --breakpoint-md in ${STYLESHEET}. Update this check with it.`);
}

const compactMax = Number(compactQuery[1]);
const themeMin = Number(themeToken[1]);

if (themeMin !== compactMax + 1) {
  fail(
    `${STYLESHEET} styles for a boundary at ${themeMin}px while ${CAPABILITIES} mounts for one at ${compactMax + 1}px.\n` +
      `  --breakpoint-md must be exactly one more than COMPACT_LAYOUT_QUERY's max-width.\n` +
      `  Fix: set --breakpoint-md to ${compactMax + 1}px, or the query to (max-width: ${themeMin - 1}px).`,
  );
}

console.log(`breakpoint: the layout boundary is ${themeMin}px in both places.`);
