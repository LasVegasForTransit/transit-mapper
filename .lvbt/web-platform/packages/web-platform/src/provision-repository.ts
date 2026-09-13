import { z } from 'zod';
import type { ProvisionResource } from './provision-reconcile.js';

const targetSchema = z.object({
  repository: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
  branch: z.string().min(1),
});
const repositorySchema = z.object({
  full_name: z.string(),
  private: z.boolean(),
  archived: z.boolean(),
  default_branch: z.string(),
  allow_merge_commit: z.boolean(),
  allow_squash_merge: z.boolean(),
  allow_rebase_merge: z.boolean(),
});
type Write = (
  method: 'POST' | 'PATCH',
  endpoint: string,
  body: Record<string, unknown>,
) => Promise<void>;

export function provisionRepository(
  input: unknown,
  read: () => Promise<unknown>,
  write: Write,
): ProvisionResource {
  const target = targetSchema.parse(input);
  const [owner, name] = target.repository.split('/') as [string, string];
  const desired = {
    full_name: target.repository,
    private: false,
    archived: false,
    default_branch: target.branch,
    allow_merge_commit: false,
    allow_squash_merge: false,
    allow_rebase_merge: true,
  };
  return {
    id: 'github.repository',
    read: async () => {
      const current = await read();
      return current === null ? null : repositorySchema.parse(current);
    },
    desired: () => desired,
    write: (before) =>
      before === null
        ? write('POST', `orgs/${owner}/repos`, {
            name,
            private: false,
            auto_init: false,
            allow_merge_commit: false,
            allow_squash_merge: false,
            allow_rebase_merge: true,
          })
        : write('PATCH', `repos/${target.repository}`, {
            private: false,
            archived: false,
            default_branch: target.branch,
            allow_merge_commit: false,
            allow_squash_merge: false,
            allow_rebase_merge: true,
          }),
  };
}
