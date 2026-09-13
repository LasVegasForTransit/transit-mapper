import { z } from 'zod';
import type { ProvisionResource } from './provision-reconcile.js';

const workerSchema = z.object({ id: z.string() });

export function provisionWorkerPresence(
  input: { name: string },
  readWorkers: () => Promise<unknown>,
  upload: () => Promise<void>,
): ProvisionResource {
  const name = z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .parse(input.name);
  return {
    id: `cloudflare.worker.${name}`,
    read: async () => {
      const matches = z
        .array(workerSchema)
        .parse(await readWorkers())
        .filter((worker) => worker.id === name);
      if (matches.length > 1) throw new Error('Duplicate Worker identities require review.');
      return matches.length === 1;
    },
    desired: () => true,
    write: upload,
  };
}
