import { z } from 'zod';
import type { ProvisionResource } from './provision-reconcile.js';

const targetSchema = z.object({
  repository: z.string().min(1),
  environment: z.string().min(1),
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
});

export function provisionEnvironmentSecret(
  input: z.input<typeof targetSchema>,
  read: () => Promise<unknown>,
  write: () => Promise<void>,
): ProvisionResource {
  const target = targetSchema.parse(input);
  return {
    id: `github.environment-secret.${target.name}`,
    read: async () => {
      const matches = z
        .object({ secrets: z.array(z.object({ name: z.string() })) })
        .parse(await read())
        .secrets.filter((secret) => secret.name === target.name);
      if (matches.length > 1) throw new Error('Duplicate environment secrets require review.');
      return matches.length === 1;
    },
    desired: () => true,
    write,
  };
}
