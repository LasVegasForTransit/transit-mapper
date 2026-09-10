import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

function managedFieldsMatch(expected: unknown, actual: unknown): boolean {
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
