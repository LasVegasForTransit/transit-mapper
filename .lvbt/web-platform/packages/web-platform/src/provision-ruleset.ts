import { z } from 'zod';
import type { ProvisionResource } from './provision-reconcile.js';
import { matchesPinnedRuleset } from './ruleset.js';

const targetSchema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
  ruleset: z.object({
    name: z.string().min(1),
    target: z.literal('branch'),
    enforcement: z.enum(['disabled', 'active', 'evaluate']),
    bypass_actors: z.array(z.unknown()),
    conditions: z.record(z.string(), z.unknown()),
    rules: z.array(z.record(z.string(), z.unknown())).min(1),
  }),
});
const summarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  target: z.string(),
  source_type: z.string(),
});
type Write = (
  method: 'POST' | 'PUT',
  endpoint: string,
  body: Record<string, unknown>,
) => Promise<void>;

export function provisionRepositoryRuleset(
  input: unknown,
  read: (endpoint: string) => Promise<unknown>,
  write: Write,
): ProvisionResource {
  const target = targetSchema.parse(input);
  const endpoint = `repos/${target.repository}/rulesets`;
  const selected = async () => {
    const input = await read(endpoint);
    if (input === null) return null;
    const matches = z
      .array(summarySchema)
      .parse(input)
      .filter(
        (ruleset) =>
          ruleset.name === target.ruleset.name &&
          ruleset.target === target.ruleset.target &&
          ruleset.source_type === 'Repository',
      );
    if (matches.length > 1) throw new Error('Duplicate repository rulesets require review.');
    return matches[0] ?? null;
  };
  return {
    id: 'github.rules',
    read: async () => {
      const summary = await selected();
      return (
        summary !== null &&
        matchesPinnedRuleset(await read(`${endpoint}/${summary.id}`), target.ruleset)
      );
    },
    desired: () => true,
    write: async () => {
      const summary = await selected();
      await write(
        summary === null ? 'POST' : 'PUT',
        summary === null ? endpoint : `${endpoint}/${summary.id}`,
        target.ruleset,
      );
    },
  };
}
