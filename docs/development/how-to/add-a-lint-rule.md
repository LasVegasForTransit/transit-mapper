# Add a lint rule

```bash
pnpm gen lint-rule
```

Emits the rule, its test file under `packages/eslint-plugin/tests/`, and a
`meta.docs.url` pointing at the section you are about to write.

Then three things, in this order:

1. Register it in `packages/eslint-plugin/src/index.ts`.
2. Scope it in `eslint.config.js` to the package it is about — most rules
   are not repository-wide.
3. Add the matching section to
   [the enforcement model](../explanation/enforcement-model.md), because
   that is where `meta.docs.url` sends anyone who trips it.

## Write the "why the compiler cannot" first

A rule duplicating something the type system already catches is a rule to
delete. `core-runtime-purity` exists because `packages/core`'s tsconfig
includes the `DOM` lib deliberately — for the ambient `fetch`, `crypto` and
`structuredClone` that both runtimes provide — which necessarily brings
`window` and `document` with it. The compiler cannot express the
distinction; that is the whole reason a rule has to.

## Prefer scope analysis over an Identifier visitor

Where a rule is about globals, walk `scope.through` rather than visiting
every `Identifier`. A reference resolving to nothing in any enclosing scope
_is_ a global — so property keys (`{ document: "x" }`), member access
(`o.document`) and locally shadowed names are excluded by construction
instead of each needing a special case.

The first version of `core-runtime-purity` did visit every `Identifier`, and
reported an object property called `document`. Its own tests caught it.

## Test the near-misses

The valid cases are the more important half. Eight of
`core-runtime-purity`'s twelve tests are near-misses that must **not** fire.

A false positive is worse than a missing rule: it teaches people to reach
for `eslint-disable`, and the next real violation leaves with it.

## When not to write one

Some rules cannot be written well, and saying so beats shipping a bad one.
The HTML-injection convention is deliberately unenforced: the two places the
Worker builds markup by interpolation are both correct, and telling a safe
interpolation from an unsafe one needs value provenance a linter does not
have. A rule there would report only false positives.

`AGENTS.md` records it as unenforced rather than leaving it looking
unfinished.
