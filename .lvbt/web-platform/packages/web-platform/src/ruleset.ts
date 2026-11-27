import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

function managedFieldsMatch(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => managedFieldsMatch(value, actual[index]))
    );
  const fields = z.record(z.string(), z.unknown()).safeParse(expected);
  if (!fields.success) return isDeepStrictEqual(expected, actual);
  const candidate = z.record(z.string(), z.unknown()).safeParse(actual);
  return (
    candidate.success &&
    Object.entries(fields.data).every(([key, value]) =>
      managedFieldsMatch(value, candidate.data[key]),
    )
  );
}

export function rulesetForOwner<T extends { rules: readonly unknown[] }>(
  standard: T,
  organizationOwned: boolean,
): T;
export function rulesetForOwner(standard: unknown, organizationOwned: boolean): unknown;
export function rulesetForOwner(standard: unknown, organizationOwned: boolean): unknown {
  if (organizationOwned) return standard;
  const parsed = z
    .object({ rules: z.array(z.object({ type: z.string() }).loose()) })
    .loose()
    .parse(standard);
  return {
    ...parsed,
    rules: parsed.rules.filter((rule) => rule.type !== 'merge_queue'),
  };
}

export function matchesPinnedRuleset(input: unknown, standard: unknown) {
  return managedFieldsMatch(standard, input);
}

export function matchesPinnedRules(input: unknown, standard: unknown) {
  const rule = z.object({
    type: z.string(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  });
  const required = z.object({ rules: z.array(rule).min(1) }).parse(standard).rules;
  const effective = z.array(rule).parse(input);
  return required.every((expected) =>
    effective.some(
      (actual) =>
        actual.type === expected.type &&
        managedFieldsMatch(expected.parameters ?? {}, actual.parameters ?? {}),
    ),
  );
}
