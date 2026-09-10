import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import type { ProvisionResource } from './provision-reconcile.js';

interface Variable {
  name: string;
  value: string;
}
type VariableWrite = (method: 'POST' | 'PATCH', endpoint: string, body: Variable) => Promise<void>;
interface VariableTarget {
  repository: string;
  accountId: string;
  zoneId: string;
}

interface RepositoryVariableTarget {
  repository: string;
  name: string;
  value: string;
}

export function provisionRepositoryVariable(
  input: RepositoryVariableTarget,
  read: (endpoint: string) => Promise<unknown>,
  write: VariableWrite,
): ProvisionResource {
  const target = z
    .object({
      repository: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/),
      name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      value: z.string(),
    })
    .parse(input);
  const desired = { name: target.name, value: target.value };
  const endpoint = `repos/${target.repository}/actions/variables`;
  return {
    id: `github.variable.${desired.name}`,
    read: async () => {
      const values = z
        .object({ variables: z.array(z.object({ name: z.string(), value: z.string() })) })
        .parse(await read(endpoint)).variables;
      const matches = values.filter((variable) => variable.name === desired.name);
      if (matches.length > 1) throw new Error('Duplicate provider variable names require review.');
      return matches[0] ?? null;
    },
    desired: () => desired,
    write: (before) =>
      write(
        before === null ? 'POST' : 'PATCH',
        before === null ? endpoint : `${endpoint}/${desired.name}`,
        desired,
      ),
  };
}

export function provisionVariables(
  target: VariableTarget,
  read: (endpoint: string) => Promise<unknown>,
  write: VariableWrite,
): ProvisionResource[] {
  return [
    { name: 'CLOUDFLARE_ACCOUNT_ID', value: target.accountId },
    { name: 'CLOUDFLARE_ZONE_ID', value: target.zoneId },
  ].map((desired) => provisionRepositoryVariable({ ...target, ...desired }, read, write));
}

export function githubVariableWriter(root: string, repository: string): VariableWrite {
  const endpoint = `repos/${repository}/actions/variables`;
  return (method, target, body) => {
    if (
      !['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ZONE_ID'].includes(body.name) ||
      target !== (method === 'POST' ? endpoint : `${endpoint}/${body.name}`)
    )
      return Promise.reject(
        new Error('The variable write is outside declared infrastructure settings.'),
      );
    try {
      execFileSync(
        'gh',
        ['api', '--hostname', 'github.com', '--method', method, '--input', '-', target],
        {
          cwd: root,
          input: JSON.stringify(body),
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 30000,
        },
      );
      return Promise.resolve();
    } catch {
      return Promise.reject(
        new Error(
          'GitHub variable write was not confirmed. Re-read provider state before retrying.',
        ),
      );
    }
  };
}
