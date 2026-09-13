import { isDeepStrictEqual } from 'node:util';

export interface ProvisionResource {
  id: string;
  read(): Promise<unknown>;
  desired(current: unknown): unknown;
  write(before: unknown, after: unknown): Promise<void>;
}

interface ProvisionOperation {
  id: string;
  status: 'matched' | 'planned' | 'blocked' | 'verified' | 'conflict' | 'unconfirmed' | 'withheld';
  before?: unknown;
  after?: unknown;
}

async function planResource(resource: ProvisionResource): Promise<ProvisionOperation> {
  try {
    const before = structuredClone(await resource.read());
    const after = structuredClone(resource.desired(structuredClone(before)));
    return {
      id: resource.id,
      before,
      after,
      status: isDeepStrictEqual(before, after) ? 'matched' : 'planned',
    };
  } catch {
    return { id: resource.id, status: 'blocked' };
  }
}

async function applyResource(resource: ProvisionResource, operation: ProvisionOperation) {
  let current: unknown;
  try {
    current = await resource.read();
  } catch {
    return 'blocked' as const;
  }
  if (isDeepStrictEqual(current, operation.after)) return 'matched' as const;
  if (!isDeepStrictEqual(current, operation.before)) return 'conflict' as const;
  try {
    await resource.write(operation.before, operation.after);
    return isDeepStrictEqual(await resource.read(), operation.after)
      ? ('verified' as const)
      : ('unconfirmed' as const);
  } catch {
    return 'unconfirmed' as const;
  }
}

export async function reconcileResources(resources: ProvisionResource[], apply: boolean) {
  if (new Set(resources.map((resource) => resource.id)).size !== resources.length)
    throw new Error('Provisioning resource IDs must be unique.');
  const operations: ProvisionOperation[] = [];
  for (const resource of resources) operations.push(await planResource(resource));
  if (!apply || operations.some((operation) => operation.status === 'blocked'))
    return {
      ok: !operations.some((operation) => operation.status === 'blocked'),
      changed: false,
      operations,
    };
  let stopped = false;
  for (const [index, resource] of resources.entries()) {
    const operation = operations[index];
    if (operation?.status !== 'planned') continue;
    if (stopped) {
      operation.status = 'withheld';
      continue;
    }
    operation.status = await applyResource(resource, operation);
    stopped = !['matched', 'verified'].includes(operation.status);
  }
  return {
    ok: operations.every((operation) => ['matched', 'verified'].includes(operation.status)),
    changed: operations.some((operation) => operation.status === 'unconfirmed')
      ? null
      : operations.some((operation) => operation.status === 'verified'),
    operations,
  };
}

export async function reconcileResourceGroups(groups: ProvisionResource[][], apply: boolean) {
  const resources = groups.flat();
  if (new Set(resources.map((resource) => resource.id)).size !== resources.length)
    throw new Error('Provisioning resource IDs must be unique.');
  if (!apply) return reconcileResources(resources, false);

  const operations: ProvisionOperation[] = [];
  let changed: boolean | null = false;
  for (const [index, group] of groups.entries()) {
    const result = await reconcileResources(group, true);
    operations.push(...result.operations);
    if (result.changed === null) changed = null;
    else if (result.changed && changed !== null) changed = true;
    if (!result.ok) {
      for (const remaining of groups.slice(index + 1).flat())
        operations.push({ id: remaining.id, status: 'withheld' });
      return { ok: false, changed, operations };
    }
  }
  return { ok: true, changed, operations };
}
