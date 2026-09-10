import { z } from 'zod';
import type { ProvisionResource } from './provision-reconcile.js';

const targetSchema = z.object({
  hostname: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/),
  workers: z.array(
    z.object({
      slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      name: z.string().regex(/^[a-z0-9-]+$/),
    }),
  ),
});
const routeSchema = z.object({
  pattern: z.string(),
  script: z.string().nullable().optional(),
});
interface Route {
  pattern: string;
  script: string;
}

function matchesHostname(pattern: string, hostname: string) {
  const host = pattern.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  const escaped = host.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.*')}$`, 'i').test(hostname);
}

export function provisionRoutes(
  input: z.input<typeof targetSchema>,
  read: () => Promise<unknown>,
  create: (route: Route) => Promise<void>,
): ProvisionResource[] {
  const target = targetSchema.parse(input);
  if (
    target.workers.filter((worker) => worker.slug === 'home').length !== 1 ||
    new Set(target.workers.map((worker) => worker.slug)).size !== target.workers.length
  )
    throw new Error('Routes require one home Worker and unique project slugs.');
  const expected = target.workers.flatMap((worker) =>
    (worker.slug === 'home'
      ? [`${target.hostname}/*`]
      : [`${target.hostname}/${worker.slug}`, `${target.hostname}/${worker.slug}/*`]
    ).map((pattern) => ({ pattern, script: worker.name })),
  );
  return expected.map((desired) => ({
    id: `cloudflare.route.${desired.pattern}`,
    read: async () => {
      const routes = z
        .array(routeSchema)
        .parse(await read())
        .filter((route) => matchesHostname(route.pattern, target.hostname));
      if (
        routes.some(
          (route) =>
            !expected.some(
              (candidate) =>
                candidate.pattern === route.pattern && candidate.script === route.script,
            ),
        )
      )
        throw new Error('Conflicting Worker routes require review before provisioning.');
      const matches = routes.filter((route) => route.pattern === desired.pattern);
      if (matches.length > 1) throw new Error('Duplicate Worker routes require review.');
      return matches[0] ?? null;
    },
    desired: () => desired,
    write: () => create(desired),
  }));
}
