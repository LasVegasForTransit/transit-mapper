import { z } from 'zod';

const sourceSchema = z.object({
  id: z.number().int().positive(),
  run_attempt: z.number().int().positive(),
  name: z.string(),
  path: z.string(),
  event: z.enum(['push', 'workflow_dispatch']),
  head_branch: z.string(),
  head_sha: z.string().regex(/^[a-f0-9]{40}$/),
  status: z.literal('completed'),
  conclusion: z.literal('success'),
  repository: z.object({ full_name: z.string() }),
  head_repository: z.object({ full_name: z.string() }),
});

export interface StagingWorkflow {
  name: string;
  path: string;
  branch?: string;
}
export const legacyStagingWorkflow: StagingWorkflow = {
  name: 'Deploy staging',
  path: '.github/workflows/deploy-production.yml',
  branch: 'main',
};

export function releaseSource(
  value: unknown,
  repository: string,
  runId: string,
  workflow: StagingWorkflow = legacyStagingWorkflow,
): { commit: string; releaseId: string } {
  if (!/^[1-9][0-9]*$/.test(runId)) throw new Error('Select an Actions run ID.');
  const source = sourceSchema.parse(value);
  if (
    source.name !== workflow.name ||
    source.path !== workflow.path ||
    source.head_branch !== (workflow.branch ?? 'main') ||
    String(source.id) !== runId ||
    source.repository.full_name !== repository ||
    source.head_repository.full_name !== repository
  )
    throw new Error('The source run must belong to this repository.');
  return { commit: source.head_sha, releaseId: String(source.id) };
}
