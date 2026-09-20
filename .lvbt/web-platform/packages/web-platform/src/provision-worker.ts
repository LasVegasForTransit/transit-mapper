import { z } from 'zod';
import type { ProvisionResource } from './provision-reconcile.js';

const workerSchema = z.object({ id: z.string() });
const workerSubdomainSchema = z.object({
  enabled: z.boolean(),
  previews_enabled: z.boolean(),
});

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

export function provisionWorkerPreviewUrls(
  input: { name: string },
  read: () => Promise<unknown>,
  write: (settings: { enabled: boolean; previews_enabled: boolean }) => Promise<void>,
): ProvisionResource {
  const name = z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .parse(input.name);
  return {
    id: `cloudflare.worker-previews.${name}`,
    read: async () => workerSubdomainSchema.parse(await read()),
    desired: (current) => ({
      ...workerSubdomainSchema.parse(current),
      previews_enabled: true,
    }),
    write: (_before, after) => write(workerSubdomainSchema.parse(after)),
  };
}
