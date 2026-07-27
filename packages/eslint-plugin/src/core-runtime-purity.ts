import type { Rule } from 'eslint';

/**
 * `packages/core` runs in two runtimes: the browser and workerd. A browser
 * global that only exists in one of them compiles cleanly and then throws in
 * production, in the runtime nobody tested.
 *
 * The type system does not catch this. Core's tsconfig includes the `DOM`
 * lib deliberately, to pick up the ambient `fetch`, `crypto` and
 * `structuredClone` typings that *both* runtimes provide — which means it
 * also picks up `window` and `document`, which only one provides.
 *
 * So the rule exists precisely because the compiler cannot express it.
 */
const FORBIDDEN = new Map<string, string>([
  ['window', 'only exists in the browser'],
  ['document', 'only exists in the browser'],
  ['localStorage', 'only exists in the browser'],
  ['sessionStorage', 'only exists in the browser'],
  ['navigator', 'differs between the browser and workerd'],
  ['alert', 'only exists in the browser'],
]);

export const coreRuntimePurity: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow browser-only globals in code that must run in both runtimes',
      url: 'https://github.com/LasVegasForTransit/transit-mapper/blob/main/docs/development/explanation/enforcement-model.md#core-runtime-purity',
    },
    schema: [],
    messages: {
      forbidden:
        "'{{name}}' {{why}}, and this package is typechecked against the browser and workerd both. " +
        'Move the code that needs it into apps/web, or pass the value in as an argument.',
    },
  },

  create(context) {
    return {
      // Scope analysis rather than an Identifier visitor. A reference that
      // resolves to nothing in any enclosing scope *is* a global reference,
      // which is exactly what this rule is about. Getting there through the
      // scope manager means property keys (`{ document: "x" }`), member
      // access (`o.document`), and locally shadowed names are all excluded
      // by construction, instead of each needing its own special case.
      'Program:exit'(node) {
        const scope = context.sourceCode.getScope(node);
        for (const ref of scope.through) {
          const why = FORBIDDEN.get(ref.identifier.name);
          if (!why) continue;
          context.report({
            node: ref.identifier,
            messageId: 'forbidden',
            data: { name: ref.identifier.name, why },
          });
        }
      },
    };
  },
};
